// End-to-end provisioning tests against DynamoDB Local (Docker).
// Skips entirely when Docker is unavailable.

import test, {beforeAll, afterAll} from 'tape-six';
import {DynamoDBClient, DeleteTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

import {Adapter, TableVerificationFailed} from 'dynamodb-toolkit';
import {ensureTable, verifyTable, readDescriptor, writeDescriptor} from 'dynamodb-toolkit/provisioning';
import {startDynamoDBLocal} from '../helpers/dynamodb-local.js';

const ctx = {skip: false, reason: null, createdTables: []};

beforeAll(async () => {
  const local = await startDynamoDBLocal();
  if (local.skip) {
    ctx.skip = true;
    ctx.reason = local.reason;
    return;
  }
  ctx.local = local;
  ctx.client = new DynamoDBClient({
    endpoint: local.endpoint,
    region: 'us-east-1',
    credentials: {accessKeyId: 'fake', secretAccessKey: 'fake'}
  });
  ctx.docClient = DynamoDBDocumentClient.from(ctx.client, {marshallOptions: {removeUndefinedValues: true}});
});

afterAll(async () => {
  if (ctx.skip) return;
  for (const table of ctx.createdTables) {
    try {
      await ctx.client.send(new DeleteTableCommand({TableName: table}));
    } catch {
      // already gone
    }
  }
  await ctx.local.stop();
  ctx.docClient.destroy();
  ctx.client.destroy();
});

const skipIfNoDocker = t => {
  if (ctx.skip) {
    t.comment('SKIP: ' + ctx.reason);
    return true;
  }
  return false;
};

const uniqueTable = prefix => {
  const t = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  ctx.createdTables.push(t);
  return t;
};

const makeAdapter = (tableName, overrides = {}) =>
  new Adapter({
    client: ctx.docClient,
    table: tableName,
    keyFields: [
      {name: 'state', type: 'string'},
      {name: 'rentalName', type: 'string'}
    ],
    structuralKey: {name: '_sk', separator: '|'},
    technicalPrefix: '_',
    indices: {
      'by-status-date': {
        type: 'gsi',
        pk: {name: 'status', type: 'string'},
        sk: {name: 'createdAt', type: 'string'},
        projection: 'all'
      }
    },
    ...overrides
  });

test('e2e provisioning: ensureTable creates a fresh table with GSI', async t => {
  if (skipIfNoDocker(t)) return;
  const tableName = uniqueTable('prov');
  const adapter = makeAdapter(tableName);
  const plan = await ensureTable(adapter);
  t.equal(plan.steps.length, 1);
  t.equal(plan.steps[0].action, 'create');

  const result = await ensureTable(adapter, {yes: true});
  t.equal(result.executed.length, 1);
  t.matchString(result.executed[0], /create:/);

  // Re-run ensure → no-op plan.
  const rerun = await ensureTable(adapter);
  t.equal(rerun.steps.length, 0, 'no-op on second ensure');
});

test('e2e provisioning: verifyTable ok on freshly ensured table', async t => {
  if (skipIfNoDocker(t)) return;
  const tableName = uniqueTable('prov');
  const adapter = makeAdapter(tableName);
  await ensureTable(adapter, {yes: true});
  const r = await verifyTable(adapter);
  t.equal(r.ok, true);
  t.equal(r.diffs.length, 0);
});

test('e2e provisioning: verifyTable detects missing GSI vs live', async t => {
  if (skipIfNoDocker(t)) return;
  const tableName = uniqueTable('prov');
  const minimalAdapter = makeAdapter(tableName, {indices: {}});
  await ensureTable(minimalAdapter, {yes: true});
  // Adapter declares a GSI that doesn't exist in the live table.
  const expandedAdapter = makeAdapter(tableName);
  const r = await verifyTable(expandedAdapter);
  t.equal(r.ok, false);
  t.ok(r.diffs.some(d => d.path === 'gsi.by-status-date' && d.severity === 'error'));
});

test('e2e provisioning: verifyTable throwOnMismatch throws TableVerificationFailed', async t => {
  if (skipIfNoDocker(t)) return;
  const tableName = uniqueTable('prov');
  const adapter = makeAdapter(tableName);
  // No ensureTable — table doesn't exist.
  let thrown;
  try {
    await verifyTable(adapter, {throwOnMismatch: true});
  } catch (e) {
    thrown = e;
  }
  t.ok(thrown instanceof TableVerificationFailed);
});

test('e2e provisioning: descriptor round-trip via ensureTable + verifyTable', async t => {
  if (skipIfNoDocker(t)) return;
  const tableName = uniqueTable('prov');
  const adapter = makeAdapter(tableName, {descriptorKey: '__adapter__'});
  const result = await ensureTable(adapter, {yes: true});
  t.equal(result.descriptorWritten, true);

  const stored = await readDescriptor(adapter);
  t.ok(stored);
  t.equal(stored.table, tableName);
  t.equal(stored.technicalPrefix, '_');

  const r = await verifyTable(adapter);
  t.equal(r.ok, true);
  t.equal(r.diffs.length, 0);
});

test('e2e provisioning: descriptor drift surfaces as warn diff', async t => {
  if (skipIfNoDocker(t)) return;
  const tableName = uniqueTable('prov');
  const adapter = makeAdapter(tableName, {descriptorKey: '__adapter__'});
  await ensureTable(adapter, {yes: true});
  // Overwrite descriptor with a stale snapshot using an adapter that
  // differs only in filterable — doesn't trigger constructor validation
  // and survives a descriptor round-trip cleanly.
  const stale = makeAdapter(tableName, {
    descriptorKey: '__adapter__',
    filterable: {status: ['eq', 'ne']}
  });
  await writeDescriptor(stale);

  const r = await verifyTable(adapter);
  // Table schema still matches — descriptor drift only.
  t.ok(r.diffs.some(d => d.path === 'descriptor.filterable' && d.severity === 'warn'));
});

test('e2e provisioning: requireDescriptor on descriptor-less table fails', async t => {
  if (skipIfNoDocker(t)) return;
  const tableName = uniqueTable('prov');
  const adapter = makeAdapter(tableName); // no descriptorKey
  await ensureTable(adapter, {yes: true});
  // Now verify with a descriptor-aware adapter; descriptor is absent.
  const strictAdapter = makeAdapter(tableName, {descriptorKey: '__adapter__'});
  const r = await verifyTable(strictAdapter, {requireDescriptor: true});
  t.equal(r.ok, false);
  t.ok(r.diffs.some(d => d.path === 'descriptor' && d.severity === 'error'));
});
