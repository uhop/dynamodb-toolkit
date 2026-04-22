// CommonJS smoke test — demonstrates dynamodb-toolkit is usable from .cjs consumers.
// Requires a Node that ships unflagged `require(esm)` — 20.19+ on the 20.x line,
// 22.12+ on 22.x, anything newer. Our `engines.node` is >=20, which is the
// Adapter's runtime floor; current 20.x releases satisfy the `require(esm)`
// requirement as well.

const {test} = require('tape-six');
const {Raw, raw, Adapter, TransactionLimitExceededError} = require('dynamodb-toolkit');
const {buildUpdate, buildCondition, cleanParams} = require('dynamodb-toolkit/expressions');
const {applyBatch, applyTransaction, getBatch, getTransaction, TRANSACTION_LIMIT, backoff} = require('dynamodb-toolkit/batch');
const mass = require('dynamodb-toolkit/mass');
const paths = require('dynamodb-toolkit/paths');
const restCore = require('dynamodb-toolkit/rest-core');
const handler = require('dynamodb-toolkit/handler');

test('cjs: main entry symbols resolve via require()', t => {
  t.equal(typeof Raw, 'function', 'Raw class');
  t.equal(typeof raw, 'function', 'raw()');
  t.equal(typeof Adapter, 'function', 'Adapter class');
  t.equal(typeof TransactionLimitExceededError, 'function', 'TransactionLimitExceededError class');
});

test('cjs: Raw round-trip works across the CJS/ESM boundary', t => {
  const item = {name: 'Tatooine'};
  const wrapped = raw(item);
  t.ok(wrapped instanceof Raw, 'raw() returns a Raw instance');
  t.equal(wrapped.item, item, 'item preserved');
});

test('cjs: expressions builders mutate params additively', t => {
  const params = {TableName: 't', Key: {name: 'Hoth'}};
  const after = buildUpdate({climate: 'frozen'}, null, params);
  t.equal(after, params, 'same params object (additive)');
  t.matchString(after.UpdateExpression, /^SET /);

  const conditioned = buildCondition([{path: 'version', op: '=', value: 1}], after);
  t.matchString(conditioned.ConditionExpression, /#cd/);

  cleanParams(conditioned);
  t.ok(conditioned.ExpressionAttributeNames, 'names retained because used');
});

test('cjs: sub-exports load and expose their public surface', t => {
  t.equal(typeof applyBatch, 'function');
  t.equal(typeof applyTransaction, 'function');
  t.equal(typeof getBatch, 'function');
  t.equal(typeof getTransaction, 'function');
  t.equal(typeof backoff, 'function');
  t.equal(TRANSACTION_LIMIT, 100);

  t.ok(mass, 'mass sub-export');
  t.ok(paths, 'paths sub-export');
  t.ok(restCore, 'rest-core sub-export');
  t.ok(handler, 'handler sub-export');
});

test('cjs: Adapter constructor enforces required options', t => {
  t.throws(() => new Adapter(), 'no options');
  t.throws(() => new Adapter({}), 'missing client');

  const adapter = new Adapter({
    client: {send: async () => ({})},
    table: 'Planets',
    keyFields: ['name']
  });
  t.equal(adapter.table, 'Planets');
  t.deepEqual(adapter.keyFields, [{name: 'name', type: 'string'}]);
});
