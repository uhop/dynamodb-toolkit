// TypeScript walkthrough — mirror of run.js with strict types.
//
// Runs against DynamoDB Local (Docker required). The goal is exercising
// the TS story: can the adapter be driven end-to-end with a discriminated
// multi-tier record union without `as any`, and how loud are the narrowing
// lapses? (So far: two type assertions in the adapter's hooks for union-
// narrowing-through-spread; everything else flows cleanly.)
//
// Run:  node examples/car-rental/run.ts     (Node 25 strips TS natively)

import {DynamoDBClient, DeleteTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient, QueryCommand, type DynamoDBDocumentClient as DDoc} from '@aws-sdk/lib-dynamodb';

import {planTable, ensureTable, verifyTable} from 'dynamodb-toolkit/provisioning';

// Intra-example imports use `.ts` extensions — Node 25 strip-types and
// `allowImportingTsExtensions` in tsconfig agree. Cross-module (.js)
// imports stay plain-.js as before.
import {createAdapter, TABLE, isState, isCar, isBoat, type AnyRecord, type StateRecord} from './adapter.ts';
import {seedAll, seedStates, seedVehicles} from './seed-data.ts';
import {startDynamoDBLocal} from '../../../tests/helpers/dynamodb-local.js';

const header = (label: string): void => console.log(`\n▶ ${label}`);
const info = (...args: unknown[]): void => console.log('  ', ...args);
const fail = (msg: string, err?: unknown): void => {
  console.error(`✗ ${msg}`);
  if (err) console.error(err);
  process.exitCode = 1;
};

const withServer = async (run: (client: DDoc) => Promise<void>): Promise<void> => {
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

const walkthrough = async (client: DDoc): Promise<void> => {
  const adapter = createAdapter(client);

  // ─── §Setup ────────────────────────────────────────────────────
  header('§Setup — planTable then ensureTable');
  const plan = await planTable(adapter);
  info(
    'Plan steps:',
    plan.steps.map(s => s.action)
  );
  plan.summary.forEach((l: string) => info(`  ${l}`));
  const created = await ensureTable(adapter);
  info('Executed:', created.executed.join(', '));

  // ─── §Seed (bulk) ──────────────────────────────────────────────
  header('§Seed (bulk) — adapter.putItems over the whole typed hierarchy');
  const bulk = await adapter.putItems(seedAll);
  info(`putItems: processed=${bulk.processed}`);

  // ─── §Typed dispatch ───────────────────────────────────────────
  header('§typeOf — discriminate the union via isState / isCar / isBoat guards');
  const page = await adapter.getListByParams({TableName: TABLE}, {limit: 100, needTotal: false});
  let stateCount = 0;
  let carCount = 0;
  let boatCount = 0;
  let maxYear = 0;
  for (const item of page.data as AnyRecord[]) {
    if (isState(item)) stateCount++;
    else if (isCar(item)) {
      carCount++;
      if (item.year > maxYear) maxYear = item.year;
    } else if (isBoat(item)) boatCount++;
  }
  info(`states=${stateCount} cars=${carCount} boats=${boatCount}; newest car year=${maxYear}`);
  if (stateCount !== seedStates.length) fail(`expected ${seedStates.length} states, saw ${stateCount}`);

  // ─── §Marshalling round-trip ───────────────────────────────────
  header('§Marshalling — managedSince revives to Date through the adapter hooks');
  const tx = (await adapter.getByKey({state: 'TX'})) as StateRecord | undefined;
  if (!tx) {
    fail('TX state record missing');
    return;
  }
  info(`TX manager=${tx.manager.name}, managedSince=${tx.managedSince.toISOString()} (${tx.managedSince.constructor.name})`);
  if (!(tx.managedSince instanceof Date)) fail('managedSince did not revive to a Date');

  // ─── §Subtree queries ──────────────────────────────────────────
  header('§Subtree — buildKey (children default; {self} adds parent; {partial} narrows)');
  const children = await adapter.getListUnder({state: 'TX'}, {limit: 50});
  info(`TX children (facilities + vehicles): ${children.data.length}`);
  const selfPlus = await client.send(new QueryCommand({TableName: TABLE, ...adapter.buildKey({state: 'TX'}, {self: true})}));
  info(`TX self + children: ${selfPlus.Items?.length ?? 0}`);

  // ─── §Filter (structured clauses, E6 typed year) ───────────────
  header('§Filter — typed year (E6 filterable.type) + typed clause shape');
  const carsIn2024 = await adapter.getListByParams(
    {...adapter.buildKey({state: 'FL'}), TableName: TABLE},
    {
      filter: [
        {field: 'kind', op: 'eq', value: 'car'},
        {field: 'year', op: 'ge', value: '2023'}
      ],
      limit: 50
    }
  );
  info(`FL cars year ≥ 2023: ${carsIn2024.data.length}`);

  // ─── §LSI auto-promote ─────────────────────────────────────────
  header('§LSI — by-price auto-selected by sort field');
  const byPrice = await adapter.getList({sort: 'dailyPriceCents', limit: 5}, {state: 'TX'});
  info(`Cheapest TX vehicles: ${byPrice.data.length} rows (LSI keys-only + hydrate)`);

  // ─── §Concurrency ──────────────────────────────────────────────
  header('§Concurrency — versionField guards stale put');
  const fresh = (await adapter.getByKey({state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-001'})) as AnyRecord & {_version?: number};
  info(`Observed _version: ${fresh._version}`);
  await adapter.patch({state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-001'}, {status: 'maintenance'});
  try {
    await adapter.put(fresh);
    fail('stale put unexpectedly succeeded');
  } catch (err) {
    const e = err as Error;
    info(`Stale put rejected: ${e.name}`);
  }

  // ─── §verifyTable ──────────────────────────────────────────────
  header('§verifyTable — declaration vs. live table');
  const verification = await verifyTable(adapter);
  info(`ok=${verification.ok} diffs=${verification.diffs.length}`);
  if (!verification.ok) {
    console.error(verification.diffs);
    fail('verifyTable reported errors');
  }

  info(`(${seedVehicles.length} leaf vehicles seeded; walkthrough covered state/car/boat branching.)`);
};

withServer(walkthrough).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
