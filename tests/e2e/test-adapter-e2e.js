// End-to-end Adapter tests against DynamoDB Local (Docker).
// Skips entirely when Docker is unavailable.

import test, {beforeAll, afterAll} from 'tape-six';
import {DynamoDBClient, CreateTableCommand, DeleteTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

import {Adapter, raw, Raw} from 'dynamodb-toolkit';
import {tableSchema} from '../fixtures/table-schema.js';
import {planets} from '../fixtures/planets.js';
import {startDynamoDBLocal} from '../helpers/dynamodb-local.js';

const ctx = {skip: false, reason: null};

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
  ctx.docClient = DynamoDBDocumentClient.from(ctx.client, {
    marshallOptions: {removeUndefinedValues: true}
  });
  ctx.tableName = 'planets-' + Math.random().toString(36).slice(2, 8);
  await ctx.client.send(new CreateTableCommand(tableSchema(ctx.tableName)));

  ctx.adapter = new Adapter({
    client: ctx.docClient,
    table: ctx.tableName,
    keyFields: ['name'],
    searchable: {climate: 1, terrain: 1}
  });
});

afterAll(async () => {
  if (ctx.skip) return;
  try {
    await ctx.client.send(new DeleteTableCommand({TableName: ctx.tableName}));
  } catch {
    // Table may already be gone
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

// --- bulk load ---

test('e2e: putAll loads all planets', async t => {
  if (skipIfNoDocker(t)) return;
  const r = await ctx.adapter.putAll(planets);
  t.equal(r.processed, planets.length, `${planets.length} items written`);
});

test('e2e: getByKey reads a single planet', async t => {
  if (skipIfNoDocker(t)) return;
  const item = await ctx.adapter.getByKey({name: 'Tatooine'});
  t.equal(item.name, 'Tatooine');
  t.equal(item.climate, 'arid');
});

test('e2e: getByKey on missing returns undefined', async t => {
  if (skipIfNoDocker(t)) return;
  const item = await ctx.adapter.getByKey({name: 'NeverWas'});
  t.equal(item, undefined);
});

test('e2e: getByKey with field projection', async t => {
  if (skipIfNoDocker(t)) return;
  const item = await ctx.adapter.getByKey({name: 'Hoth'}, ['name', 'climate']);
  t.equal(item.name, 'Hoth');
  t.equal(item.climate, 'frozen');
  t.equal(item.diameter, undefined, 'unprojected field absent');
});

test('e2e: getByKeys returns multiple', async t => {
  if (skipIfNoDocker(t)) return;
  const items = await ctx.adapter.getByKeys([{name: 'Hoth'}, {name: 'Tatooine'}, {name: 'Bespin'}]);
  t.equal(items.length, 3);
  const names = items.map(i => i.name).sort();
  t.deepEqual(names, ['Bespin', 'Hoth', 'Tatooine']);
});

test('e2e: getByKeys missing keys are dropped', async t => {
  if (skipIfNoDocker(t)) return;
  const items = await ctx.adapter.getByKeys([{name: 'Hoth'}, {name: 'NeverWas'}]);
  t.equal(items.length, 1);
  t.equal(items[0].name, 'Hoth');
});

// --- write / read round-trip ---

test('e2e: post creates new item; second post throws ConditionalCheckFailed', async t => {
  if (skipIfNoDocker(t)) return;
  await ctx.adapter.post({name: 'NewPlanet', climate: 'mild'});
  const item = await ctx.adapter.getByKey({name: 'NewPlanet'});
  t.equal(item.climate, 'mild');

  let err;
  try {
    await ctx.adapter.post({name: 'NewPlanet', climate: 'other'});
  } catch (e) {
    err = e;
  }
  t.ok(err, 'second post failed');
  t.equal(err.name, 'ConditionalCheckFailedException');

  await ctx.adapter.delete({name: 'NewPlanet'});
});

test('e2e: put with force overwrites', async t => {
  if (skipIfNoDocker(t)) return;
  await ctx.adapter.put({name: 'Tatooine', climate: 'replaced'}, {force: true});
  const after = await ctx.adapter.getByKey({name: 'Tatooine'});
  t.equal(after.climate, 'replaced');
  t.equal(after.diameter, undefined, 'old fields gone');
  // restore
  const original = planets.find(p => p.name === 'Tatooine');
  await ctx.adapter.put(original, {force: true});
});

test('e2e: put without force fails when item missing', async t => {
  if (skipIfNoDocker(t)) return;
  let err;
  try {
    await ctx.adapter.put({name: 'NotThere', climate: 'whatever'});
  } catch (e) {
    err = e;
  }
  t.ok(err);
  t.equal(err.name, 'ConditionalCheckFailedException');
});

test('e2e: patch updates existing fields and removes via delete option', async t => {
  if (skipIfNoDocker(t)) return;
  await ctx.adapter.patch({name: 'Hoth'}, {gravity: '1.5g'}, {delete: ['surface_water']});
  const item = await ctx.adapter.getByKey({name: 'Hoth'});
  t.equal(item.gravity, '1.5g');
  t.equal(item.surface_water, undefined, 'surface_water removed');
  // restore
  const original = planets.find(p => p.name === 'Hoth');
  await ctx.adapter.put(original, {force: true});
});

test('e2e: delete is idempotent (DDB does not error on missing)', async t => {
  if (skipIfNoDocker(t)) return;
  await ctx.adapter.delete({name: 'AlreadyGone'});
  t.pass('no error thrown');
});

// --- mass ops ---

test('e2e: getAllByParams paginates', async t => {
  if (skipIfNoDocker(t)) return;
  const r = await ctx.adapter.getAllByParams({}, {offset: 0, limit: 10});
  t.equal(r.data.length, 10);
  t.equal(r.offset, 0);
  t.equal(r.limit, 10);
  t.equal(r.total, planets.length, 'total reflects all planets');
});

test('e2e: getAllByParams with offset', async t => {
  if (skipIfNoDocker(t)) return;
  const r = await ctx.adapter.getAllByParams({}, {offset: 5, limit: 5});
  t.equal(r.data.length, 5);
  t.equal(r.offset, 5);
});

test('e2e: getAllByParams needTotal:false omits total', async t => {
  if (skipIfNoDocker(t)) return;
  const r = await ctx.adapter.getAllByParams({}, {offset: 0, limit: 5, needTotal: false});
  t.equal(r.data.length, 5);
  t.equal(r.total, undefined);
});

test('e2e: deleteByKeys removes specified items', async t => {
  if (skipIfNoDocker(t)) return;
  await ctx.adapter.putAll([
    {name: 'tmp1', x: 1},
    {name: 'tmp2', x: 2},
    {name: 'tmp3', x: 3}
  ]);
  const r = await ctx.adapter.deleteByKeys([{name: 'tmp1'}, {name: 'tmp2'}, {name: 'tmp3'}]);
  t.equal(r.processed, 3);
  const check = await ctx.adapter.getByKey({name: 'tmp1'});
  t.equal(check, undefined);
});

// --- Raw bypass ---

test('e2e: post(raw(item)) bypasses prepare and writes verbatim', async t => {
  if (skipIfNoDocker(t)) return;
  await ctx.adapter.post(raw({name: 'RawWrite', _internal: 'kept'}));
  const item = await ctx.adapter.getByKey({name: 'RawWrite'}, undefined, {reviveItems: false});
  t.ok(item instanceof Raw);
  t.equal(item.item._internal, 'kept');
  await ctx.adapter.delete({name: 'RawWrite'});
});

// --- transaction auto-upgrade ---

test('e2e: checkConsistency triggers TransactWriteItems', async t => {
  if (skipIfNoDocker(t)) return;
  await ctx.adapter.put({name: 'Parent', children: 0}, {force: true});
  const childAdapter = new Adapter({
    client: ctx.docClient,
    table: ctx.tableName,
    keyFields: ['name'],
    hooks: {
      checkConsistency: async _batch => [
        {
          action: 'check',
          params: {
            TableName: ctx.tableName,
            Key: {name: 'Parent'},
            ConditionExpression: 'attribute_exists(#k0)',
            ExpressionAttributeNames: {'#k0': 'name'}
          }
        }
      ]
    }
  });
  await childAdapter.post({name: 'Child1'});
  const child = await ctx.adapter.getByKey({name: 'Child1'});
  t.ok(child, 'child created');

  await ctx.adapter.delete({name: 'Parent'});
  let err;
  try {
    await childAdapter.post({name: 'Child2'});
  } catch (e) {
    err = e;
  }
  t.ok(err, 'consistency check failed without parent');
  t.matchString(err.name, /TransactionCanceledException|ConditionalCheckFailedException/);

  await ctx.adapter.delete({name: 'Child1'});
});
