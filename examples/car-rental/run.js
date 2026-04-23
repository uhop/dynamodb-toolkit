// End-to-end walkthrough against DynamoDB Local. Exercises the full
// 3.7.0 surface through the car-rental data model (state → facility →
// vehicle; vehicles are cars OR boats). Prints each section's outcome;
// exits 0 on success, non-zero on failure. Docker is required — script
// skips with a clear message otherwise.

import {DynamoDBClient, DeleteTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient, QueryCommand} from '@aws-sdk/lib-dynamodb';

import {planTable, ensureTable, verifyTable} from 'dynamodb-toolkit/provisioning';

import {createAdapter, TABLE} from './adapter.js';
import {seedAll, seedVehicles, seedStates} from './seed-data.js';
import {startDynamoDBLocal} from '../../tests/helpers/dynamodb-local.js';

// -------------------------------------------------------------------
// plumbing
// -------------------------------------------------------------------

const header = label => console.log(`\n▶ ${label}`);
const info = (...args) => console.log('  ', ...args);

const fail = (msg, err) => {
  console.error(`✗ ${msg}`);
  if (err) console.error(err);
  process.exitCode = 1;
};

const withServer = async run => {
  const local = await startDynamoDBLocal();
  if (local.skip) {
    console.log(`SKIP: ${local.reason}`);
    return;
  }
  const base = new DynamoDBClient({
    endpoint: local.endpoint,
    region: 'us-east-1',
    credentials: {accessKeyId: 'fake', secretAccessKey: 'fake'}
  });
  const client = DynamoDBDocumentClient.from(base, {marshallOptions: {removeUndefinedValues: true}});
  try {
    await run(client);
  } finally {
    try {
      await base.send(new DeleteTableCommand({TableName: TABLE}));
    } catch {}
    await local.stop();
    client.destroy();
    base.destroy();
  }
};

// -------------------------------------------------------------------
// walkthrough
// -------------------------------------------------------------------

const walkthrough = async client => {
  const adapter = createAdapter(client);

  // ─── §Setup ────────────────────────────────────────────────────
  header('§Setup — planTable (read-only) then ensureTable (executes)');
  const plan = await planTable(adapter);
  info(
    'Plan steps:',
    plan.steps.map(s => s.action)
  );
  plan.summary.forEach(l => info(`  ${l}`));
  const created = await ensureTable(adapter);
  info('Executed:', created.executed.join(', '));
  info('Descriptor written:', Boolean(created.descriptorWritten));

  // ─── §Seed (bulk) ──────────────────────────────────────────────
  header('§Seed (bulk) — adapter.putItems does BatchWriteItem chunking for the whole hierarchy');
  const bulk = await adapter.putItems(seedAll);
  info(`putItems: processed=${bulk.processed} across ${seedAll.length} input items (states + facilities + vehicles).`);

  // ─── §Typed dispatch across all four tiers ─────────────────────
  header('§typeOf — typeField stamped state/facility on write; leaf kind wins for car/boat');
  // Going through getListByParams (not raw ScanCommand) so E2's hide-
  // descriptor filter kicks in — the descriptor row would otherwise
  // classify as a tier-1 "state" record and inflate the count.
  const mixed = await adapter.getListByParams({TableName: TABLE}, {limit: 100, needTotal: false});
  const tiers = {state: 0, facility: 0, car: 0, boat: 0};
  for (const item of mixed.data) {
    const t = adapter.typeOf(item);
    tiers[t] = (tiers[t] || 0) + 1;
  }
  info('Tier counts:', tiers);
  if (tiers.state !== seedStates.length) fail(`expected ${seedStates.length} states, saw ${tiers.state}`);

  // ─── §Marshalling round-trip via the adapter's hook ────────────
  header('§Marshalling — Date round-trips through the prepare/revive hooks (F6 Stage 1)');
  const txState = await adapter.getByKey({state: 'TX'});
  info(`TX state: manager=${txState.manager.name}, managedSince=${txState.managedSince} (${typeof txState.managedSince})`);
  if (!(txState.managedSince instanceof Date)) fail('managedSince did not revive to a Date');

  // ─── §Simple read — round-trip version + createdAt ─────────────
  header('§Read — getByKey exposes _version (1 after put) and _createdAt');
  const camry = await adapter.getByKey({state: 'TX', facility: 'Dallas', vehicle: 'VIN-TX-001'});
  info(`Camry: v${camry._version} created ${camry._createdAt}`);
  info(`  → adapter.typeOf = ${adapter.typeOf(camry)}`);

  // ─── §Subtree reads via buildKey ───────────────────────────────
  header('§Subtree queries — adapter.buildKey (children by default; {self} / {partial} as options)');
  const txAll = await client.send(new QueryCommand({TableName: TABLE, ...adapter.buildKey({state: 'TX'})}));
  info(`Children of {state: 'TX'}: ${txAll.Items.length} (facilities + vehicles; state row excluded)`);
  const txSelf = await client.send(new QueryCommand({TableName: TABLE, ...adapter.buildKey({state: 'TX'}, {self: true})}));
  info(`{self: true} at state: ${txSelf.Items.length} (state row included)`);
  const txDal = await client.send(new QueryCommand({TableName: TABLE, ...adapter.buildKey({state: 'TX'}, {partial: 'Dal'})}));
  info(`{partial: 'Dal'}: ${txDal.Items.length} (anything under TX|Dal*)`);

  // ─── §getListUnder sugar (E5) ──────────────────────────────────
  header('§getListUnder — shorthand for getListByParams(buildKey(...))');
  const flUnder = await adapter.getListUnder({state: 'FL'}, {limit: 50});
  info(`getListUnder({state: 'FL'}): ${flUnder.data.length} items`);

  // ─── §Filter grammar ───────────────────────────────────────────
  header('§Filter — URL grammar ?<op>-<field>=<value>; polymorphic clause shape');
  const listCars = await adapter.getListByParams(
    {...adapter.buildKey({state: 'FL'}), TableName: TABLE},
    {filter: [{field: 'kind', op: 'eq', value: 'car'}], limit: 50}
  );
  info(`FL cars only: ${listCars.data.length}`);
  const budget = await adapter.getListByParams(
    {...adapter.buildKey({state: 'FL'}), TableName: TABLE},
    {
      filter: [
        {field: 'kind', op: 'eq', value: 'boat'},
        {field: 'dailyPriceCents', op: 'lt', value: 30000}
      ],
      limit: 50
    }
  );
  info(`FL boats under $300/day: ${budget.data.length}`);
  // E6 — numeric coercion via filterable.type on `year` (not a keyField).
  const newRides = await adapter.getListByParams(
    {...adapter.buildKey({state: 'TX'}), TableName: TABLE},
    {filter: [{field: 'year', op: 'ge', value: '2023'}], limit: 50}
  );
  info(`TX vehicles with year >= 2023: ${newRides.data.length} (string '2023' coerced to number via filterable.type)`);

  // ─── §LSI — auto-selected by sort field ────────────────────────
  header('§LSI — `by-price` auto-promotes when sort matches its sk');
  const byPrice = await adapter.getList({sort: 'dailyPriceCents', limit: 10}, {state: 'TX'});
  info(`TX vehicles sorted by price (ascending): ${byPrice.data.length} (LSI keys-only → second-hop read)`);

  // ─── §GSI — explicit index name, cross-partition ───────────────
  header('§GSI — `by-status-createdAt` cross-partition Query for rented fleet');
  const rented = await client.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'by-status-createdAt',
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: {'#s': 'status'},
      ExpressionAttributeValues: {':s': 'rented'},
      Limit: 20
    })
  );
  info(`Rented (global, all states): ${rented.Items.length}`);

  // ─── §Resumable mass op ────────────────────────────────────────
  header('§Resumable mass op — deleteListByParams {maxItems} emits a cursor');
  const throwaway = Array.from({length: 7}, (_, i) => ({
    state: 'NV',
    facility: 'Vegas',
    vehicle: `VIN-NV-${String(i).padStart(3, '0')}`,
    kind: 'car',
    status: 'available',
    dailyPriceCents: 5000 + i * 100,
    make: 'Generic',
    model: 'Rental',
    year: 2024
  }));
  await adapter.putItems(throwaway);
  let cursor;
  let pass = 0;
  let processed = 0;
  do {
    const params = {...adapter.buildKey({state: 'NV', facility: 'Vegas'}), TableName: TABLE};
    const page = await adapter.deleteListByParams(params, {maxItems: 3, resumeToken: cursor});
    processed += page.processed;
    info(`  pass ${++pass}: processed=${page.processed} cursor=${page.cursor ? 'present' : 'done'}`);
    cursor = page.cursor;
  } while (cursor);
  info(`Total processed across ${pass} pages: ${processed}`);

  // ─── §edit() ───────────────────────────────────────────────────
  header('§edit() — read-diff-update; no-op short-circuits WCU');
  const edited = await adapter.edit({state: 'TX', facility: 'Dallas', vehicle: 'VIN-TX-001'}, item => ({...item, status: 'rented'}));
  info(`VIN-TX-001 status → ${edited.status}, version → ${edited._version}`);
  const noop = await adapter.edit({state: 'TX', facility: 'Dallas', vehicle: 'VIN-TX-001'}, item => item);
  info(`no-op edit version unchanged: ${noop._version === edited._version}`);

  // ─── §editListByParams ─────────────────────────────────────────
  header('§editListByParams — in-place update of every Austin car');
  const bulkEdit = await adapter.editListByParams({...adapter.buildKey({state: 'TX', facility: 'Austin'}), TableName: TABLE}, item => ({
    ...item,
    promotionTag: 'summer2026'
  }));
  info(`Austin edits: processed=${bulkEdit.processed} skipped=${bulkEdit.skipped}`);

  // ─── §rename ──────────────────────────────────────────────────
  header('§rename — subtree prefix-swap (TX/Austin → TX/NewAustin)');
  const renameResult = await adapter.rename({state: 'TX', facility: 'Austin'}, {state: 'TX', facility: 'NewAustin'});
  info(`Renamed: processed=${renameResult.processed} skipped=${renameResult.skipped}`);

  // ─── §Cascade primitives ───────────────────────────────────────
  header('§Cascade — cloneAllUnder then deleteAllUnder');
  const clone = await adapter.cloneAllUnder({state: 'TX', facility: 'Dallas'}, {state: 'TX', facility: 'Plano'});
  info(`cloneAllUnder: processed=${clone.processed} skipped=${clone.skipped}`);
  const del = await adapter.deleteAllUnder({state: 'TX', facility: 'Plano'});
  info(`deleteAllUnder: processed=${del.processed}`);

  // ─── §Optimistic concurrency ───────────────────────────────────
  header('§Concurrency — versionField guards stale writes');
  const fresh = await adapter.getByKey({state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-001'});
  info(`Observed version: ${fresh._version}`);
  await adapter.patch({state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-001'}, {status: 'maintenance'});
  try {
    await adapter.put(fresh);
    fail('stale put unexpectedly succeeded');
  } catch (err) {
    info(`Stale put rejected: ${err.name} (${err.message.slice(0, 70)}…)`);
  }
  const latest = await adapter.getByKey({state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-001'});
  await adapter.delete({state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-001'}, {expectedVersion: latest._version});
  info('Delete with {expectedVersion} succeeded.');

  // ─── §asOf scope-freeze ────────────────────────────────────────
  header('§asOf — filter scans to items createdAt ≤ T');
  const asOf = new Date().toISOString();
  await new Promise(r => setTimeout(r, 20));
  await adapter.post({
    state: 'CA',
    facility: 'LA',
    vehicle: 'VIN-CA-NEW',
    kind: 'car',
    status: 'available',
    dailyPriceCents: 6000,
    make: 'Kia',
    model: 'Telluride',
    year: 2024
  });
  const frozen = await adapter.getListByParams({...adapter.buildKey({state: 'CA'}), TableName: TABLE}, {asOf, limit: 50});
  info(`CA vehicles at ${asOf}: ${frozen.data.length} (new post excluded)`);
  const live = await adapter.getListByParams({...adapter.buildKey({state: 'CA'}), TableName: TABLE}, {limit: 50});
  info(`CA vehicles live: ${live.data.length}`);

  // ─── §verifyTable ──────────────────────────────────────────────
  header('§verifyTable — declaration vs. live table drift check');
  const verification = await verifyTable(adapter);
  info(`ok=${verification.ok} diffs=${verification.diffs.length}`);
  if (!verification.ok) {
    console.error(verification.diffs);
    fail('verifyTable reported errors');
  }
  info(`(Vehicle count total: ${seedVehicles.length} — some edits / renames / cascades above.)`);
};

// -------------------------------------------------------------------
// main
// -------------------------------------------------------------------

withServer(walkthrough).catch(err => {
  console.error(err);
  process.exit(1);
});
