import test from 'tape-six';
import {Adapter, raw, Raw, TransactionLimitExceededError} from 'dynamodb-toolkit';
import {makeMockClient} from './helpers/mock-client.js';

const TABLE = 'TestTable';

const makeAdapter = (clientHandler, overrides = {}) => {
  const client = makeMockClient(clientHandler);
  const adapter = new Adapter({
    client,
    table: TABLE,
    keyFields: ['name'],
    ...overrides
  });
  return {adapter, client};
};

// --- constructor ---

test('Adapter: throws on missing required options', t => {
  t.throws(() => new Adapter(), 'no options');
  t.throws(() => new Adapter({}), 'missing client');
  t.throws(() => new Adapter({client: {}}), 'missing table');
  t.throws(() => new Adapter({client: {}, table: 't'}), 'missing keyFields');
});

test('Adapter: rejects non-array keyFields', t => {
  t.throws(() => new Adapter({client: {}, table: 't', keyFields: 'name'}), 'string is not an array');
  t.throws(() => new Adapter({client: {}, table: 't', keyFields: {}}), 'object is not an array');
  t.throws(() => new Adapter({client: {}, table: 't', keyFields: []}), 'empty array');
});

test('Adapter: defaults applied', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.deepEqual(adapter.projectionFieldMap, {});
  t.deepEqual(adapter.searchable, {});
  t.equal(adapter.searchablePrefix, '-search-');
  t.deepEqual(adapter.indirectIndices, {});
});

// --- typed keyFields + structuralKey declaration ---

test('Adapter: keyFields normalizes bare-string and descriptor forms', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', {name: 'rentalId', type: 'number', width: 5}, 'carVin'],
    structuralKey: {name: '-sk'}
  });
  t.equal(adapter.keyFields.length, 3);
  t.deepEqual(adapter.keyFields[0], {name: 'state', type: 'string'});
  t.deepEqual(adapter.keyFields[1], {name: 'rentalId', type: 'number', width: 5});
  t.deepEqual(adapter.keyFields[2], {name: 'carVin', type: 'string'});
});

test('Adapter: composite keyFields without structuralKey throws', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['state', 'carVin']}), 'structuralKey required for composite');
});

test('Adapter: single-field keyFields does not require structuralKey', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name']});
  t.equal(adapter.structuralKey, undefined, 'no structuralKey for single-field keyFields');
});

test('Adapter: structuralKey defaults separator to "|"', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  t.equal(adapter.structuralKey.separator, '|');
});

test('Adapter: structuralKey accepts custom separator', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk', separator: '::'}
  });
  t.equal(adapter.structuralKey.separator, '::');
});

test('Adapter: number keyFields in composite requires width', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['state', {name: 'id', type: 'number'}],
        structuralKey: {name: '-sk'}
      }),
    'number without width in composite'
  );
});

test('Adapter: number keyFields in single-field keyFields does not require width', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: [{name: 'id', type: 'number'}]});
  t.equal(adapter.keyFields[0].type, 'number');
  t.equal(adapter.keyFields[0].width, undefined, 'width optional for single-field');
});

test('Adapter: rejects invalid keyField entry shapes', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: [42]}), 'number entry');
  t.throws(() => new Adapter({client, table: 'T', keyFields: [{type: 'string'}]}), 'missing field');
  t.throws(() => new Adapter({client, table: 'T', keyFields: [{name: 'x', type: 'date'}]}), 'unknown type');
});

// --- typeLabels + typeDiscriminator ---

test('Adapter: typeLabels length must match keyFields', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['state', 'rentalName', 'carVin'],
        structuralKey: {name: '-sk'},
        typeLabels: ['state', 'rental']
      }),
    'typeLabels shorter than keyFields'
  );
});

test('Adapter: typeLabels stored', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'},
    typeLabels: ['state', 'rental', 'car']
  });
  t.deepEqual(adapter.typeLabels, ['state', 'rental', 'car']);
});

// --- adapter.typeOf ---

test('adapter.typeOf: depth-based label from typeLabels', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'},
    typeLabels: ['state', 'rental', 'car']
  });
  t.equal(adapter.typeOf({state: 'TX'}), 'state');
  t.equal(adapter.typeOf({state: 'TX', rentalName: 'Dallas'}), 'rental');
  t.equal(adapter.typeOf({state: 'TX', rentalName: 'Dallas', carVin: 'V123'}), 'car');
});

test('adapter.typeOf: depth-based stops at first missing field (contiguous-from-start)', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'},
    typeLabels: ['state', 'rental', 'car']
  });
  // carVin present but rentalName missing → depth stops at state.
  t.equal(adapter.typeOf({state: 'TX', carVin: 'V123'}), 'state');
});

test('adapter.typeOf: returns raw depth number when typeLabels not declared', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  t.equal(adapter.typeOf({state: 'TX'}), 1);
  t.equal(adapter.typeOf({state: 'TX', rentalName: 'Dallas'}), 2);
});

test('adapter.typeOf: typeDiscriminator wins over depth when field is present', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'},
    typeLabels: ['state', 'rental', 'car'],
    typeDiscriminator: {name: 'kind'}
  });
  // Depth would say 'car' but kind field overrides.
  t.equal(adapter.typeOf({state: 'TX', rentalName: 'Dallas', carVin: 'V', kind: 'truck'}), 'truck');
});

test('adapter.typeOf: returns undefined for empty item', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  t.equal(adapter.typeOf({}), undefined);
  t.equal(adapter.typeOf(null), undefined);
  t.equal(adapter.typeOf(undefined), undefined);
});

// --- getByKey ---

test('getByKey: returns item via GetCommand', async t => {
  const sent = [];
  const {adapter, client} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {Item: {name: 'Hoth', climate: 'frozen'}};
  });

  const item = await adapter.getByKey({name: 'Hoth'});
  t.equal(sent.length, 1);
  t.equal(sent[0].constructor.name, 'GetCommand');
  t.equal(sent[0].input.TableName, TABLE);
  t.deepEqual(sent[0].input.Key, {name: 'Hoth'});
  t.deepEqual(item, {name: 'Hoth', climate: 'frozen'});
  client.send.mock.restore();
});

test('getByKey: missing item returns undefined', async t => {
  const {adapter} = makeAdapter(async () => ({}));
  const item = await adapter.getByKey({name: 'Nowhere'});
  t.equal(item, undefined);
});

test('getByKey: reviveItems:false returns Raw', async t => {
  const {adapter} = makeAdapter(async () => ({Item: {name: 'Hoth'}}));
  const item = await adapter.getByKey({name: 'Hoth'}, undefined, {reviveItems: false});
  t.ok(item instanceof Raw, 'wrapped in Raw');
  t.deepEqual(item.item, {name: 'Hoth'});
});

test('getByKey: with fields adds ProjectionExpression', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {Item: {name: 'Hoth', climate: 'frozen'}};
  });
  await adapter.getByKey({name: 'Hoth'}, ['name', 'climate']);
  t.ok(sent[0].input.ProjectionExpression, 'projection set');
  t.ok(sent[0].input.ExpressionAttributeNames, 'EAN set');
});

// --- post / put / patch / delete (single ops) ---

test('post: sends PutCommand with attribute_not_exists condition', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });

  await adapter.post({name: 'Tatooine', climate: 'arid'});
  t.equal(sent[0].constructor.name, 'PutCommand');
  t.deepEqual(sent[0].input.Item, {name: 'Tatooine', climate: 'arid'});
  t.matchString(sent[0].input.ConditionExpression, /attribute_not_exists/);
});

test('put: default sends PutCommand with attribute_exists condition', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.put({name: 'Tatooine'});
  t.matchString(sent[0].input.ConditionExpression, /attribute_exists/);
});

test('put: force=true skips existence check', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.put({name: 'Tatooine'}, {force: true});
  t.equal(sent[0].input.ConditionExpression, undefined);
});

test('patch: sends UpdateCommand without key fields in payload', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.patch({name: 'Hoth'}, {name: 'Hoth', climate: 'cold'});
  t.equal(sent[0].constructor.name, 'UpdateCommand');
  t.deepEqual(sent[0].input.Key, {name: 'Hoth'});
  t.matchString(sent[0].input.UpdateExpression, /^SET /);
  // Only one SET assignment (climate); name is excluded
  const setCount = (sent[0].input.UpdateExpression.match(/=/g) || []).length;
  t.equal(setCount, 1, 'one SET assignment, key excluded');
  // The single SET value alias maps to 'cold'
  const eav = sent[0].input.ExpressionAttributeValues;
  t.deepEqual(Object.values(eav), ['cold']);
});

test('patch: respects delete option', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.patch({name: 'Hoth'}, {climate: 'cold'}, {delete: ['oldField']});
  t.matchString(sent[0].input.UpdateExpression, /REMOVE/);
});

test('delete: sends DeleteCommand', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.delete({name: 'Hoth'});
  t.equal(sent[0].constructor.name, 'DeleteCommand');
  t.deepEqual(sent[0].input.Key, {name: 'Hoth'});
});

// --- edit ---

test('edit: diffs and emits UpdateCommand with SET/REMOVE only for changed fields', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'GetCommand') {
      return {Item: {name: 'X', hp: 10, force: 'light', stale: 'yes'}};
    }
    return {};
  });
  const result = await adapter.edit({name: 'X'}, () => ({name: 'X', hp: 20, force: 'light'}));
  const update = sent.find(c => c.constructor.name === 'UpdateCommand');
  t.ok(update, 'emits UpdateCommand');
  const expr = update.input.UpdateExpression;
  t.ok(/SET /.test(expr), 'has SET');
  t.ok(/REMOVE /.test(expr), 'has REMOVE for dropped field');
  const values = update.input.ExpressionAttributeValues || {};
  const valueList = Object.values(values);
  t.ok(valueList.includes(20), 'hp=20 written');
  t.notOk(valueList.includes('light'), 'unchanged field not written');
  t.equal(result?.hp, 20);
});

test('edit: no-op when mapFn returns identical item', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'X', hp: 10}};
    return {};
  });
  const result = await adapter.edit({name: 'X'}, item => ({...item}));
  const updates = sent.filter(c => c.constructor.name === 'UpdateCommand');
  t.equal(updates.length, 0, 'no UpdateCommand emitted');
  t.equal(result?.hp, 10, 'returns the revived item');
});

test('edit: undefined when source item missing', async t => {
  const {adapter} = makeAdapter(async () => ({Item: undefined}));
  const result = await adapter.edit({name: 'MISS'}, item => ({...item, hp: 100}));
  t.equal(result, undefined);
});

test('edit: undefined when mapFn returns falsy', async t => {
  const {adapter} = makeAdapter(async cmd => {
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'X', hp: 10}};
    return {};
  });
  const result = await adapter.edit({name: 'X'}, () => null);
  t.equal(result, undefined);
});

test('edit: throws KeyFieldChanged when mapFn changes a key field', async t => {
  const {adapter} = makeAdapter(async cmd => {
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'X', hp: 10}};
    return {};
  });
  let err;
  try {
    await adapter.edit({name: 'X'}, () => ({name: 'Y', hp: 10}));
  } catch (e) {
    err = e;
  }
  t.ok(err, 'threw');
  t.equal(err?.name, 'KeyFieldChanged');
  t.deepEqual(err?.fields, ['name']);
});

test('edit: allowKeyChange auto-promotes to move', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'X', hp: 10}};
    return {};
  });
  await adapter.edit({name: 'X'}, () => ({name: 'Y', hp: 10}), {allowKeyChange: true});
  // move() does post+delete in a transaction
  const txn = sent.find(c => c.constructor.name === 'TransactWriteCommand');
  t.ok(txn, 'emits TransactWriteCommand for the promoted move');
});

test('edit: readFields limits GetItem ProjectionExpression', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'X', hp: 10}};
    return {};
  });
  await adapter.edit({name: 'X'}, item => ({...item, hp: 20}), {readFields: ['name', 'hp']});
  const get = sent.find(c => c.constructor.name === 'GetCommand');
  t.ok(get?.input.ProjectionExpression, 'projection present');
});

// --- returnFailedItem ---

test('post: returnFailedItem sets ReturnValuesOnConditionCheckFailure', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.post({name: 'X'}, {returnFailedItem: true});
  t.equal(sent[0].input.ReturnValuesOnConditionCheckFailure, 'ALL_OLD');
});

test('post: default omits ReturnValuesOnConditionCheckFailure', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.post({name: 'X'});
  t.equal(sent[0].input.ReturnValuesOnConditionCheckFailure, undefined);
});

test('put: returnFailedItem sets ReturnValuesOnConditionCheckFailure', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.put({name: 'X'}, {returnFailedItem: true});
  t.equal(sent[0].input.ReturnValuesOnConditionCheckFailure, 'ALL_OLD');
});

test('patch: returnFailedItem sets ReturnValuesOnConditionCheckFailure', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.patch({name: 'X'}, {climate: 'cold'}, {returnFailedItem: true});
  t.equal(sent[0].input.ReturnValuesOnConditionCheckFailure, 'ALL_OLD');
});

test('delete: returnFailedItem sets ReturnValuesOnConditionCheckFailure', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.delete({name: 'X'}, {conditions: [{path: 'v', op: '=', value: 1}], returnFailedItem: true});
  t.equal(sent[0].input.ReturnValuesOnConditionCheckFailure, 'ALL_OLD');
});

test('makePost: returnFailedItem propagates to descriptor params', async t => {
  const {adapter} = makeAdapter(async () => ({}));
  const d = await adapter.makePost({name: 'X'}, {returnFailedItem: true});
  t.equal(d.params.ReturnValuesOnConditionCheckFailure, 'ALL_OLD');
});

// --- transaction auto-upgrade ---

test('post: checkConsistency returns checks → TransactWriteCommand', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  adapter.hooks.checkConsistency = async () => [
    {action: 'check', params: {TableName: TABLE, Key: {name: 'parent'}, ConditionExpression: 'attribute_exists(#k0)'}}
  ];

  await adapter.post({name: 'Child'});
  t.equal(sent[0].constructor.name, 'TransactWriteCommand');
  t.equal(sent[0].input.TransactItems.length, 2, 'check + put');
  t.ok(sent[0].input.TransactItems[0].ConditionCheck, 'first is check');
  t.ok(sent[0].input.TransactItems[1].Put, 'second is put');
});

test('patch: checkConsistency returns empty array → TransactWriteCommand', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  adapter.hooks.checkConsistency = async () => [];
  await adapter.patch({name: 'Hoth'}, {climate: 'cold'});
  t.equal(sent[0].constructor.name, 'TransactWriteCommand');
  t.equal(sent[0].input.TransactItems.length, 1);
});

test('post: TransactionLimitExceededError when checks > limit', async t => {
  const {adapter} = makeAdapter(async () => ({}));
  const lots = Array.from({length: 100}, () => ({action: 'check', params: {TableName: TABLE, Key: {name: 'x'}}}));
  adapter.hooks.checkConsistency = async () => lots;
  try {
    await adapter.post({name: 'Y'});
    t.fail('should have thrown');
  } catch (e) {
    t.ok(e instanceof TransactionLimitExceededError, 'correct error class');
    t.equal(e.actionCount, 101);
  }
});

// --- hooks ---

test('hooks: revive called on read; prepare called on write', async t => {
  const calls = [];
  const {adapter} = makeAdapter(
    async cmd => {
      if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'Hoth', climate: 'frozen', _internal: 'x'}};
      return {};
    },
    {
      hooks: {
        prepare: item => {
          calls.push(['prepare', item]);
          return {...item, _internal: 'set'};
        },
        revive: item => {
          calls.push(['revive', item]);
          const {_internal: _, ...rest} = item;
          return rest;
        }
      }
    }
  );

  const got = await adapter.getByKey({name: 'Hoth'});
  t.equal(calls.filter(([n]) => n === 'revive').length, 1, 'revive called once');
  t.notOk(got._internal, '_internal stripped');

  await adapter.post({name: 'Tatooine'});
  t.equal(calls.filter(([n]) => n === 'prepare').length, 1, 'prepare called on post');
});

test('hooks: validateItem invoked on post', async t => {
  let validateCount = 0;
  const {adapter} = makeAdapter(async () => ({}), {
    hooks: {
      validateItem: async () => {
        ++validateCount;
      }
    }
  });
  await adapter.post({name: 'X'});
  t.equal(validateCount, 1);
});

test('hooks: validateItem skipped for Raw items', async t => {
  let validateCount = 0;
  const {adapter} = makeAdapter(async () => ({}), {
    hooks: {
      validateItem: async () => {
        ++validateCount;
      }
    }
  });
  await adapter.post(raw({name: 'X', _bypass: true}));
  t.equal(validateCount, 0, 'bypassed');
});

test('hooks: prepare skipped for Raw items', async t => {
  const sent = [];
  let prepareCount = 0;
  const {adapter} = makeAdapter(
    async cmd => {
      sent.push(cmd);
      return {};
    },
    {
      hooks: {
        prepare: item => {
          ++prepareCount;
          return {...item, prepared: true};
        }
      }
    }
  );
  await adapter.post(raw({name: 'Bare'}));
  t.equal(prepareCount, 0, 'prepare not called');
  t.deepEqual(sent[0].input.Item, {name: 'Bare'});
});

// --- indirect indices ---

test('getByKey: indirect index does second-hop GetCommand', async t => {
  const sent = [];
  const {adapter} = makeAdapter(
    async cmd => {
      sent.push(cmd);
      // first hop: GSI returns the base table key only
      if (sent.length === 1) return {Item: {name: 'Hoth'}};
      // second hop: base table returns full item
      return {Item: {name: 'Hoth', climate: 'frozen', diameter: '7200'}};
    },
    {indirectIndices: {'climate-index': 1}}
  );

  const item = await adapter.getByKey({climate: 'frozen'}, undefined, {params: {IndexName: 'climate-index'}});
  t.equal(sent.length, 2, 'two GetCommands');
  t.equal(sent[0].input.IndexName, 'climate-index', 'first uses index');
  t.notOk(sent[1].input.IndexName, 'second hits base table');
  t.equal(item.diameter, '7200', 'base-table fields present');
});

test('getByKey: ignoreIndirection skips second-hop', async t => {
  const sent = [];
  const {adapter} = makeAdapter(
    async cmd => {
      sent.push(cmd);
      return {Item: {name: 'Hoth'}};
    },
    {indirectIndices: {'climate-index': 1}}
  );

  await adapter.getByKey({climate: 'frozen'}, undefined, {params: {IndexName: 'climate-index'}, ignoreIndirection: true});
  t.equal(sent.length, 1, 'only one call');
});

// --- mass operations ---

test('putItems: native uses BatchWrite', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {UnprocessedItems: {}};
  });
  const r = await adapter.putItems([{name: 'A'}, {name: 'B'}, {name: 'C'}]);
  t.equal(r.processed, 3);
  t.equal(sent[0].constructor.name, 'BatchWriteCommand');
});

test('putItems: native initializes versionField on first-write items', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    return {UnprocessedItems: {}};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    technicalPrefix: '_',
    versionField: '_version'
  });
  await adapter.putItems([{name: 'A'}, {name: 'B'}]);
  const batch = sent[0].input.RequestItems.T;
  for (const req of batch) {
    t.equal(req.PutRequest.Item._version, 1, 'first-write items get _version: 1');
  }
});

test('putItems: sequential uses individual Puts', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  const r = await adapter.putItems([{name: 'A'}, {name: 'B'}], {strategy: 'sequential'});
  t.equal(r.processed, 2);
  t.equal(sent.filter(c => c.constructor.name === 'PutCommand').length, 2);
});

test('putItems: sequential propagates options.params', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.putItems([{name: 'A'}], {strategy: 'sequential', params: {ReturnConsumedCapacity: 'TOTAL'}});
  t.equal(sent[0].input.ReturnConsumedCapacity, 'TOTAL', 'params.ReturnConsumedCapacity flows through');
});

test('deleteByKeys: uses BatchWrite', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {UnprocessedItems: {}};
  });
  const r = await adapter.deleteByKeys([{name: 'A'}, {name: 'B'}]);
  t.equal(r.processed, 2);
  t.equal(sent[0].constructor.name, 'BatchWriteCommand');
});

test('moveByKeys: mapFn returning falsy drops the delete too', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'BatchGetCommand') {
      return {
        Responses: {
          [TABLE]: [
            {name: 'keep', v: 1},
            {name: 'drop', v: 2}
          ]
        },
        UnprocessedKeys: {}
      };
    }
    return {UnprocessedItems: {}};
  });

  const r = await adapter.moveByKeys([{name: 'keep'}, {name: 'drop'}], item => (item.name === 'drop' ? null : {...item, v: item.v + 100}));

  // Only "keep" should be moved: 1 put + 1 delete = 2
  t.equal(r.processed, 2, 'only paired items counted');
  const writeCmd = sent.find(c => c.constructor.name === 'BatchWriteCommand');
  const requests = writeCmd.input.RequestItems[TABLE];
  t.equal(requests.length, 2, 'one put + one delete (not orphaned delete for dropped item)');
  const deletedNames = requests.filter(r => r.DeleteRequest).map(r => r.DeleteRequest.Key.name);
  t.deepEqual(deletedNames, ['keep'], '"drop" was NOT deleted because mapFn returned null');
});

test('getByKeys: uses BatchGet', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {
      Responses: {
        [TABLE]: [
          {name: 'A', x: 1},
          {name: 'B', x: 2}
        ]
      },
      UnprocessedKeys: {}
    };
  });
  const items = await adapter.getByKeys([{name: 'A'}, {name: 'B'}]);
  t.equal(sent[0].constructor.name, 'BatchGetCommand');
  t.equal(items.length, 2);
});

test('getByKeys: length-preserving with undefined at missing positions', async t => {
  // BatchGet returns in arbitrary order; missing keys don't appear in Responses.
  const {adapter} = makeAdapter(async () => ({
    Responses: {
      [TABLE]: [
        {name: 'C', x: 3},
        {name: 'A', x: 1}
      ]
    },
    UnprocessedKeys: {}
  }));
  const items = await adapter.getByKeys([{name: 'A'}, {name: 'MISSING'}, {name: 'C'}]);
  t.equal(items.length, 3, 'length matches input keys');
  t.equal(items[0]?.x, 1, 'position 0 → A');
  t.equal(items[1], undefined, 'position 1 → MISSING');
  t.equal(items[2]?.x, 3, 'position 2 → C');
});

// --- batch builders ---

test('makeGet/makePost/makePut/makePatch/makeDelete return descriptors', async t => {
  const {adapter} = makeAdapter(async () => ({}));

  const getD = await adapter.makeGet({name: 'X'});
  t.equal(getD.action, 'get');
  t.equal(getD.adapter, adapter);

  const postD = await adapter.makePost({name: 'X'});
  t.equal(postD.action, 'put');
  t.matchString(postD.params.ConditionExpression, /attribute_not_exists/);

  const putD = await adapter.makePut({name: 'X'}, {force: true});
  t.equal(putD.action, 'put');
  t.equal(putD.params.ConditionExpression, undefined);

  const patchD = await adapter.makePatch({name: 'X'}, {y: 1});
  t.equal(patchD.action, 'patch');

  const delD = await adapter.makeDelete({name: 'X'});
  t.equal(delD.action, 'delete');
});

// --- getList / getListByParams ---

// --- Condition dispatch (ifNotExists / ifExists) on clone mass ops ---

test('cloneByKeys: {ifNotExists} switches to per-item PutCommand with condition', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'BatchGetCommand') {
      return {Responses: {[TABLE]: [{name: 'A'}]}, UnprocessedKeys: {}};
    }
    return {};
  });
  const r = await adapter.cloneByKeys([{name: 'A'}], x => ({...x, name: 'A-copy'}), {ifNotExists: true});
  const puts = sent.filter(c => c.constructor.name === 'PutCommand');
  t.equal(puts.length, 1, 'per-item PutCommand used');
  t.matchString(puts[0].input.ConditionExpression, /attribute_not_exists/);
  t.equal(r.processed, 1);
  t.equal(r.skipped, 0);
});

test('cloneByKeys: {ifNotExists} buckets CCF into skipped', async t => {
  const {adapter} = makeAdapter(async cmd => {
    if (cmd.constructor.name === 'BatchGetCommand') {
      return {Responses: {[TABLE]: [{name: 'A'}]}, UnprocessedKeys: {}};
    }
    if (cmd.constructor.name === 'PutCommand') {
      const err = new Error('cond fail');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    return {};
  });
  const r = await adapter.cloneByKeys([{name: 'A'}], x => x, {ifNotExists: true});
  t.equal(r.processed, 0);
  t.equal(r.skipped, 1, 'CCF → skipped bucket');
  t.equal(r.failed.length, 0);
});

test('cloneByKeys: {ifExists} uses attribute_exists condition', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'BatchGetCommand') {
      return {Responses: {[TABLE]: [{name: 'A'}]}, UnprocessedKeys: {}};
    }
    return {};
  });
  await adapter.cloneByKeys([{name: 'A'}], x => x, {ifExists: true});
  const puts = sent.filter(c => c.constructor.name === 'PutCommand');
  t.matchString(puts[0].input.ConditionExpression, /attribute_exists/);
  t.ok(!/attribute_not_exists/.test(puts[0].input.ConditionExpression));
});

test('cloneListByParams: {ifNotExists} uses per-item PutCommand', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: [{name: 'A'}]};
    return {};
  });
  const r = await adapter.cloneListByParams({TableName: TABLE}, x => ({...x, name: 'A-copy'}), {ifNotExists: true});
  const puts = sent.filter(c => c.constructor.name === 'PutCommand');
  t.equal(puts.length, 1);
  t.matchString(puts[0].input.ConditionExpression, /attribute_not_exists/);
  t.equal(r.processed, 1);
});

test('cloneByKeys: ValidationException → failed bucket, not thrown', async t => {
  const {adapter} = makeAdapter(async cmd => {
    if (cmd.constructor.name === 'BatchGetCommand') {
      return {Responses: {[TABLE]: [{name: 'A'}]}, UnprocessedKeys: {}};
    }
    if (cmd.constructor.name === 'PutCommand') {
      const err = new Error('bad');
      err.name = 'ValidationException';
      throw err;
    }
    return {};
  });
  const r = await adapter.cloneByKeys([{name: 'A'}], x => x, {ifNotExists: true});
  t.equal(r.processed, 0);
  t.equal(r.failed.length, 1);
  t.equal(r.failed[0].reason, 'ValidationException');
});

// --- createdAtField / asOf (scope-freeze) ---

const makeTimedAdapter = clientHandler =>
  makeAdapter(clientHandler, {
    technicalPrefix: '_',
    createdAtField: '_createdAt'
  });

test('Adapter: createdAtField requires technicalPrefix', t => {
  t.throws(
    () =>
      new Adapter({
        client: makeMockClient(async () => ({})),
        table: TABLE,
        keyFields: ['name'],
        createdAtField: '_c'
      }),
    'throws without technicalPrefix'
  );
});

test('Adapter: createdAtField must start with technicalPrefix', t => {
  t.throws(
    () =>
      new Adapter({
        client: makeMockClient(async () => ({})),
        table: TABLE,
        keyFields: ['name'],
        technicalPrefix: '_',
        createdAtField: 'createdAt'
      }),
    'throws on prefix mismatch'
  );
});

test('asOf: adds FilterExpression <= :asOf on deleteListByParams', async t => {
  const sent = [];
  const {adapter} = makeTimedAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: []};
    return {};
  });
  await adapter.deleteListByParams({TableName: TABLE}, {asOf: '2026-04-20T00:00:00Z'});
  const scan = sent.find(c => c.constructor.name === 'ScanCommand' || c.constructor.name === 'QueryCommand');
  t.matchString(scan.input.FilterExpression, /<=/);
  const values = scan.input.ExpressionAttributeValues || {};
  t.ok(Object.values(values).includes('2026-04-20T00:00:00Z'));
});

test('asOf: Date is auto-converted to ISO 8601', async t => {
  const sent = [];
  const {adapter} = makeTimedAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'QueryCommand' || cmd.constructor.name === 'ScanCommand') return {Items: []};
    return {};
  });
  const d = new Date('2026-04-20T00:00:00Z');
  await adapter.deleteListByParams({TableName: TABLE}, {asOf: d});
  const scan = sent.find(c => c.constructor.name === 'ScanCommand' || c.constructor.name === 'QueryCommand');
  const values = scan.input.ExpressionAttributeValues || {};
  t.ok(Object.values(values).includes(d.toISOString()));
});

test('asOf: numeric timestamp passed through', async t => {
  const sent = [];
  const {adapter} = makeTimedAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'QueryCommand' || cmd.constructor.name === 'ScanCommand') return {Items: []};
    return {};
  });
  await adapter.deleteListByParams({TableName: TABLE}, {asOf: 1745107200000});
  const scan = sent.find(c => c.constructor.name === 'ScanCommand' || c.constructor.name === 'QueryCommand');
  const values = scan.input.ExpressionAttributeValues || {};
  t.ok(Object.values(values).includes(1745107200000));
});

test('asOf: AND-merges with existing FilterExpression', async t => {
  const sent = [];
  const {adapter} = makeTimedAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'QueryCommand' || cmd.constructor.name === 'ScanCommand') return {Items: []};
    return {};
  });
  await adapter.deleteListByParams(
    {
      TableName: TABLE,
      FilterExpression: 'attribute_exists(#foo)',
      ExpressionAttributeNames: {'#foo': 'foo'}
    },
    {asOf: '2026-04-20T00:00:00Z'}
  );
  const scan = sent.find(c => c.constructor.name === 'ScanCommand' || c.constructor.name === 'QueryCommand');
  t.matchString(scan.input.FilterExpression, /AND/);
  t.matchString(scan.input.FilterExpression, /attribute_exists/);
  t.matchString(scan.input.FilterExpression, /<=/);
});

test('asOf: throws CreatedAtFieldNotDeclared when adapter lacks the field', async t => {
  const {adapter} = makeAdapter(async () => ({}));
  let err;
  try {
    await adapter.deleteListByParams({TableName: TABLE}, {asOf: new Date()});
  } catch (e) {
    err = e;
  }
  t.equal(err?.name, 'CreatedAtFieldNotDeclared');
});

test('asOf: works on cloneListByParams / moveListByParams / editListByParams', async t => {
  const sent = [];
  const {adapter} = makeTimedAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'ScanCommand' || cmd.constructor.name === 'QueryCommand') return {Items: []};
    return {};
  });
  await adapter.cloneListByParams({TableName: TABLE}, x => x, {asOf: 1000});
  await adapter.moveListByParams({TableName: TABLE}, x => x, {asOf: 2000});
  await adapter.editListByParams({TableName: TABLE}, x => x, {asOf: 3000});
  const scans = sent.filter(c => c.constructor.name === 'ScanCommand' || c.constructor.name === 'QueryCommand');
  t.equal(scans.length, 3);
  for (const s of scans) t.matchString(s.input.FilterExpression, /<=/);
});

test('asOf: works on rename / cloneWithOverwrite macros', async t => {
  const sent = [];
  const {adapter} = makeAdapter(
    async cmd => {
      sent.push(cmd);
      if (cmd.constructor.name === 'QueryCommand' || cmd.constructor.name === 'ScanCommand') return {Items: []};
      return {};
    },
    {
      keyFields: [
        {name: 'state', type: 'string'},
        {name: 'rentalName', type: 'string'}
      ],
      structuralKey: {name: '_sk'},
      technicalPrefix: '_',
      createdAtField: '_createdAt'
    }
  );
  await adapter.rename({state: 'TX'}, {state: 'FL'}, {asOf: '2026-04-20T00:00:00Z'});
  await adapter.cloneWithOverwrite({state: 'TX'}, {state: 'FL'}, {asOf: '2026-04-20T00:00:00Z'});
  const queries = sent.filter(c => c.constructor.name === 'QueryCommand');
  t.equal(queries.length, 2);
  for (const q of queries) t.matchString(q.input.FilterExpression, /<=/);
});

test('revive: preserves createdAtField', async t => {
  const {adapter} = makeTimedAdapter(async () => ({
    Item: {name: 'X', _createdAt: 1000, hp: 10}
  }));
  const item = await adapter.getByKey({name: 'X'});
  t.equal(item._createdAt, 1000);
});

test('prepare: accepts incoming createdAtField', async t => {
  const sent = [];
  const {adapter} = makeTimedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.post({name: 'X', _createdAt: 1000});
  t.equal(sent[0].input.Item._createdAt, 1000);
});

// --- versionField (optimistic concurrency) ---

const makeVersionedAdapter = clientHandler =>
  makeAdapter(clientHandler, {
    technicalPrefix: '_',
    versionField: '_version'
  });

test('Adapter: versionField requires technicalPrefix', t => {
  t.throws(
    () =>
      new Adapter({
        client: makeMockClient(async () => ({})),
        table: TABLE,
        keyFields: ['name'],
        versionField: '_v'
      }),
    'throws without technicalPrefix'
  );
});

test('Adapter: versionField must start with technicalPrefix', t => {
  t.throws(
    () =>
      new Adapter({
        client: makeMockClient(async () => ({})),
        table: TABLE,
        keyFields: ['name'],
        technicalPrefix: '_',
        versionField: 'myversion'
      }),
    'throws when prefix mismatch'
  );
});

test('post: sets versionField to 1 on first write', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.post({name: 'X'});
  t.equal(sent[0].input.Item._version, 1, 'initial version written');
  t.matchString(sent[0].input.ConditionExpression, /attribute_not_exists/);
});

test('put: conditions on observed version, writes observed + 1', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.put({name: 'X', _version: 3, hp: 10});
  t.equal(sent[0].input.Item._version, 4, 'version bumped');
  t.matchString(sent[0].input.ConditionExpression, /attribute_not_exists.*OR.*=/);
  const values = sent[0].input.ExpressionAttributeValues || {};
  t.ok(Object.values(values).includes(3), 'observed version in condition values');
});

test('put: missing version → first-write path (attribute_not_exists only)', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.put({name: 'X', hp: 10});
  t.equal(sent[0].input.Item._version, 1);
  t.matchString(sent[0].input.ConditionExpression, /attribute_not_exists/);
  t.ok(!/OR/.test(sent[0].input.ConditionExpression), 'no OR branch when observed is undefined');
});

test('put: force=true skips condition but still bumps version', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.put({name: 'X', _version: 5}, {force: true});
  t.equal(sent[0].input.Item._version, 6);
  t.equal(sent[0].input.ConditionExpression, undefined);
});

test('put: CCF on version mismatch surfaces as ConditionalCheckFailedException', async t => {
  const {adapter} = makeVersionedAdapter(async () => {
    const err = new Error('stale');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  });
  let err;
  try {
    await adapter.put({name: 'X', _version: 1});
  } catch (e) {
    err = e;
  }
  t.equal(err?.name, 'ConditionalCheckFailedException');
});

test('patch: with expectedVersion conditions + ADD increments version', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.patch({name: 'X'}, {hp: 20}, {expectedVersion: 2});
  const up = sent[0];
  t.matchString(up.input.UpdateExpression, /SET /);
  t.matchString(up.input.UpdateExpression, /ADD /);
  t.matchString(up.input.ConditionExpression, /attribute_not_exists.*OR.*=/);
  const values = up.input.ExpressionAttributeValues || {};
  t.ok(Object.values(values).includes(2), 'expectedVersion in condition values');
  t.ok(Object.values(values).includes(1), 'ADD clause uses +1');
});

test('patch: without expectedVersion still increments version, conditions on existence only', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.patch({name: 'X'}, {hp: 20});
  t.matchString(sent[0].input.UpdateExpression, /ADD /);
  // Patch requires the item to exist; without `expectedVersion` the
  // version condition is skipped but the existence guard stays.
  t.matchString(sent[0].input.ConditionExpression, /attribute_exists/);
  t.ok(!/OR/.test(sent[0].input.ConditionExpression), 'no OR branch without expectedVersion');
  t.ok(!/attribute_not_exists/.test(sent[0].input.ConditionExpression), 'no attribute_not_exists guard');
});

test('delete: with expectedVersion adds version condition; no increment', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.delete({name: 'X'}, {expectedVersion: 4});
  t.equal(sent[0].constructor.name, 'DeleteCommand');
  t.matchString(sent[0].input.ConditionExpression, /=/);
  const values = sent[0].input.ExpressionAttributeValues || {};
  t.ok(Object.values(values).includes(4));
});

test('delete: without expectedVersion is unconditional (idempotent)', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.delete({name: 'X'});
  t.equal(sent[0].input.ConditionExpression, undefined);
});

test('revive: preserves versionField (caller can round-trip it)', async t => {
  const {adapter} = makeVersionedAdapter(async () => ({
    Item: {name: 'X', _version: 7, hp: 10}
  }));
  const item = await adapter.getByKey({name: 'X'});
  t.equal(item._version, 7, 'versionField preserved through revive');
});

test('prepare: accepts incoming versionField from caller', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  // User passes _version through from a prior read — must not trip the
  // "technicalPrefix collision" guard.
  await adapter.put({name: 'X', _version: 2, hp: 10});
  t.equal(sent[0].input.Item._version, 3);
});

test('edit: auto-reads observed version, conditions on it, increments', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'X', _version: 5, hp: 10}};
    return {};
  });
  const result = await adapter.edit({name: 'X'}, item => ({...item, hp: 999}));
  const up = sent.find(c => c.constructor.name === 'UpdateCommand');
  t.ok(up, 'UpdateCommand emitted');
  t.matchString(up.input.UpdateExpression, /ADD /);
  t.matchString(up.input.ConditionExpression, /attribute_not_exists.*OR.*=/);
  const values = up.input.ExpressionAttributeValues || {};
  t.ok(Object.values(values).includes(5), 'observed version = 5');
  t.equal(result?._version, 6, 'returned item reflects incremented version');
});

test('edit: mapFn mutating versionField is silently overridden', async t => {
  const sent = [];
  const {adapter} = makeVersionedAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'X', _version: 5, hp: 10}};
    return {};
  });
  // User tries to set version to 999 — toolkit should ignore and ADD +1.
  await adapter.edit({name: 'X'}, item => ({...item, _version: 999, hp: 20}));
  const up = sent.find(c => c.constructor.name === 'UpdateCommand');
  const values = up.input.ExpressionAttributeValues || {};
  t.notOk(Object.values(values).includes(999), 'user-mutated version rejected');
  t.ok(Object.values(values).includes(5), 'observed=5 wins');
});

test('editListByParams: CCF on versionField → conflicts bucket', async t => {
  let call = 0;
  const {adapter} = makeVersionedAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: [{name: 'A', _version: 1, hp: 10}]};
    if (n === 'UpdateCommand') {
      ++call;
      const err = new Error('stale');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    return {};
  });
  const r = await adapter.editListByParams({TableName: TABLE}, item => ({...item, hp: 99}));
  t.equal(r.processed, 0);
  t.equal(r.skipped, 0, 'not skipped with versionField');
  t.equal(r.conflicts.length, 1, 'CCF bucketed into conflicts');
  t.equal(r.conflicts[0].reason, 'VersionConflict');
  t.ok(call > 0);
});

// --- rename / cloneWithOverwrite subtree macros ---

const makeHierarchicalAdapter = clientHandler =>
  makeAdapter(clientHandler, {
    keyFields: [
      {name: 'state', type: 'string'},
      {name: 'rentalName', type: 'string'}
    ],
    structuralKey: {name: '_sk', separator: '|'},
    technicalPrefix: '_'
  });

test('rename: put-then-delete per item; source scope becomes empty, destination has items', async t => {
  const sent = [];
  const {adapter} = makeHierarchicalAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', rentalName: 'Dallas', _sk: 'TX|Dallas', hp: 1}]};
    }
    return {};
  });
  const r = await adapter.rename({state: 'TX'}, {state: 'FL'});
  t.equal(r.processed, 1);
  const puts = sent.filter(c => c.constructor.name === 'PutCommand');
  const deletes = sent.filter(c => c.constructor.name === 'DeleteCommand');
  t.equal(puts.length, 1, 'one put');
  t.equal(deletes.length, 1, 'one delete');
  const putOrder = sent.indexOf(puts[0]);
  const deleteOrder = sent.indexOf(deletes[0]);
  t.ok(putOrder < deleteOrder, 'put (constructive) before delete (destructive)');
  t.matchString(puts[0].input.ConditionExpression, /attribute_not_exists/);
});

test('rename: destination already exists → CCF on put → skipped, source untouched', async t => {
  const sent = [];
  const {adapter} = makeHierarchicalAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', rentalName: 'Dallas', _sk: 'TX|Dallas'}]};
    }
    if (n === 'PutCommand') {
      const err = new Error('dst exists');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    return {};
  });
  const r = await adapter.rename({state: 'TX'}, {state: 'FL'});
  t.equal(r.processed, 0);
  t.equal(r.skipped, 1);
  t.equal(sent.filter(c => c.constructor.name === 'DeleteCommand').length, 0, 'no delete when put refused');
});

test('rename: options.mapFn composes with swapPrefix', async t => {
  const sent = [];
  const {adapter} = makeHierarchicalAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', rentalName: 'Dallas', hp: 1}]};
    }
    return {};
  });
  await adapter.rename({state: 'TX'}, {state: 'FL'}, {mapFn: item => ({...item, migrated: true})});
  const put = sent.find(c => c.constructor.name === 'PutCommand');
  t.equal(put.input.Item.state, 'FL', 'state shifted');
  t.equal(put.input.Item.migrated, true, 'mapFn applied');
});

test('cloneWithOverwrite: delete-then-put per item; source stays intact', async t => {
  const sent = [];
  const {adapter} = makeHierarchicalAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', rentalName: 'Dallas', hp: 1}]};
    }
    return {};
  });
  const r = await adapter.cloneWithOverwrite({state: 'TX'}, {state: 'FL'});
  t.equal(r.processed, 1);
  const deletes = sent.filter(c => c.constructor.name === 'DeleteCommand');
  const puts = sent.filter(c => c.constructor.name === 'PutCommand');
  t.equal(deletes.length, 1, 'one delete (for dst, not src)');
  t.equal(puts.length, 1, 'one put (for dst)');
  const delOrder = sent.indexOf(deletes[0]);
  const putOrder = sent.indexOf(puts[0]);
  t.ok(delOrder < putOrder, 'delete (destructive) before put (constructive)');
  t.equal(puts[0].input.ConditionExpression, undefined);
});

test('cloneWithOverwrite: put failure after successful delete → failed bucket', async t => {
  const {adapter} = makeHierarchicalAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', rentalName: 'Dallas'}]};
    }
    if (n === 'PutCommand') {
      const err = new Error('bad');
      err.name = 'ValidationException';
      throw err;
    }
    return {};
  });
  const r = await adapter.cloneWithOverwrite({state: 'TX'}, {state: 'FL'});
  t.equal(r.processed, 0);
  t.equal(r.failed.length, 1);
  t.equal(r.failed[0].reason, 'ValidationException');
});

test('rename: resumable via maxItems + resumeToken', async t => {
  const pages = [
    {
      Items: [
        {state: 'TX', rentalName: 'Dallas'},
        {state: 'TX', rentalName: 'Houston'}
      ],
      LastEvaluatedKey: {_sk: 'TX|Houston'}
    },
    {Items: [{state: 'TX', rentalName: 'Austin'}]}
  ];
  let call = 0;
  const {adapter} = makeHierarchicalAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return pages[call++];
    return {};
  });
  const r = await adapter.rename({state: 'TX'}, {state: 'FL'}, {maxItems: 2});
  t.equal(r.processed, 2);
  t.ok(r.cursor);
});

// --- cascade primitives (A6' / 3.5.0) ---

const makeCascadeAdapter = clientHandler =>
  makeAdapter(clientHandler, {
    keyFields: [
      {name: 'state', type: 'string'},
      {name: 'city', type: 'string'},
      {name: 'rentalName', type: 'string'}
    ],
    structuralKey: {name: '_sk', separator: '|'},
    technicalPrefix: '_',
    relationships: {structural: true}
  });

test('relationships: {structural: true} requires composite keyFields + structuralKey', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], relationships: {structural: true}}), 'single-field keyFields rejected');
  // composite but structuralKey is auto-required; the toolkit already throws before relationships fires,
  // so this path would hit the earlier structuralKey-required check.
  t.doesNotThrow(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['state', 'city'],
        structuralKey: {name: '_sk'},
        relationships: {structural: true}
      }),
    'composite + structuralKey accepted'
  );
});

test('relationships: rejects non-object and non-boolean structural', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['a'], relationships: 'yes'}), 'non-object');
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['state', 'city'],
        structuralKey: {name: '_sk'},
        relationships: {structural: 'yes'}
      }),
    'non-boolean structural'
  );
});

test('cascade: methods throw CascadeNotDeclared without relationships declaration', async t => {
  const {adapter} = makeAdapter(async () => ({}), {
    keyFields: [
      {name: 'state', type: 'string'},
      {name: 'city', type: 'string'}
    ],
    structuralKey: {name: '_sk'},
    technicalPrefix: '_'
  });
  await t.rejects(adapter.deleteAllUnder({state: 'TX'}), 'deleteAllUnder refuses');
  await t.rejects(adapter.cloneAllUnder({state: 'TX'}, {state: 'FL'}), 'cloneAllUnder refuses');
  await t.rejects(
    adapter.cloneAllUnderBy({state: 'TX'}, item => item),
    'cloneAllUnderBy refuses'
  );
  await t.rejects(adapter.moveAllUnder({state: 'TX'}, {state: 'FL'}), 'moveAllUnder refuses');
  await t.rejects(
    adapter.moveAllUnderBy({state: 'TX'}, item => item),
    'moveAllUnderBy refuses'
  );
});

test('deleteAllUnder: deletes descendants via BatchWrite + self via ifExists delete', async t => {
  const sent = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {
        Items: [
          {state: 'TX', city: 'Austin', rentalName: 'R1', _sk: 'TX|Austin|R1'},
          {state: 'TX', city: 'Austin', rentalName: 'R2', _sk: 'TX|Austin|R2'}
        ]
      };
    }
    return {};
  });
  const r = await adapter.deleteAllUnder({state: 'TX', city: 'Austin'});
  t.equal(r.processed, 3, 'two descendants + self');
  const selfDelete = sent.find(c => c.constructor.name === 'DeleteCommand' && c.input.ConditionExpression);
  t.ok(selfDelete, 'self delete uses ConditionExpression');
  t.matchString(selfDelete.input.ConditionExpression, /attribute_exists/);
});

test('deleteAllUnder: self absent → skipped bucket increments', async t => {
  const {adapter} = makeCascadeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: []};
    if (n === 'DeleteCommand' && cmd.input.ConditionExpression) {
      const err = new Error('no such item');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    return {};
  });
  const r = await adapter.deleteAllUnder({state: 'TX', city: 'Austin'});
  t.equal(r.processed, 0);
  t.equal(r.skipped, 1, 'self was absent');
});

test('deleteAllUnder: cursor from descendants → self deferred', async t => {
  let call = 0;
  const pages = [
    {Items: [{state: 'TX', city: 'Austin', rentalName: 'R1', _sk: 'TX|Austin|R1'}], LastEvaluatedKey: {_sk: 'TX|Austin|R1'}},
    {Items: [{state: 'TX', city: 'Austin', rentalName: 'R2', _sk: 'TX|Austin|R2'}]}
  ];
  const sent = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return pages[call++];
    return {};
  });
  const r = await adapter.deleteAllUnder({state: 'TX', city: 'Austin'}, {maxItems: 1});
  t.ok(r.cursor, 'cursor returned');
  t.equal(sent.filter(c => c.constructor.name === 'DeleteCommand' && c.input.ConditionExpression).length, 0, 'self-delete not run while paginating');
});

test('cloneAllUnder: prefix-swap subtree with self-clone; source stays', async t => {
  const sent = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', city: 'Austin', rentalName: 'R1', _sk: 'TX|Austin|R1'}]};
    }
    if (n === 'GetCommand') {
      return {Item: {state: 'TX', city: 'Austin', _sk: 'TX|Austin'}};
    }
    return {};
  });
  const r = await adapter.cloneAllUnder({state: 'TX', city: 'Austin'}, {state: 'TX', city: 'Dallas'});
  t.equal(r.processed, 2, 'self + 1 descendant');
  // Self-clone goes through PutCommand (single-op path);
  // descendant goes through BatchWriteCommand (mass-op path).
  const selfPut = sent.find(c => c.constructor.name === 'PutCommand');
  t.ok(selfPut, 'self-clone via PutCommand');
  t.equal(selfPut.input.Item.city, 'Dallas', 'self city shifted');
  const batch = sent.find(c => c.constructor.name === 'BatchWriteCommand');
  t.ok(batch, 'descendant via BatchWrite');
  const batchPut = batch.input.RequestItems[TABLE][0].PutRequest.Item;
  t.equal(batchPut.city, 'Dallas', 'descendant city shifted');
  t.equal(sent.filter(c => c.constructor.name === 'DeleteCommand').length, 0, 'source untouched');
});

test('cloneAllUnder: options.mapFn composes after prefix swap', async t => {
  const puts = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', city: 'Austin', rentalName: 'R1', _sk: 'TX|Austin|R1', hp: 5}]};
    }
    if (n === 'GetCommand') {
      return {Item: {state: 'TX', city: 'Austin', _sk: 'TX|Austin'}};
    }
    if (n === 'PutCommand') puts.push(cmd.input.Item);
    if (n === 'BatchWriteCommand') {
      for (const req of cmd.input.RequestItems[TABLE]) puts.push(req.PutRequest.Item);
    }
    return {};
  });
  await adapter.cloneAllUnder({state: 'TX', city: 'Austin'}, {state: 'TX', city: 'Dallas'}, {mapFn: item => ({...item, marked: true})});
  t.equal(puts.length, 2, 'self + descendant');
  t.ok(
    puts.every(p => p.marked === true),
    'mapFn applied'
  );
  t.ok(
    puts.every(p => p.city === 'Dallas'),
    'swap still in effect'
  );
});

test('cloneAllUnder: resumeToken skips self-clone', async t => {
  const sent = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: []};
    return {};
  });
  await adapter.cloneAllUnder({state: 'TX', city: 'Austin'}, {state: 'TX', city: 'Dallas'}, {resumeToken: 'eyJfc2siOiJUWHxBdXN0aW58UjEifQ=='});
  t.equal(sent.filter(c => c.constructor.name === 'GetCommand').length, 0, 'self-clone skipped');
});

test('cloneAllUnderBy: mapFn drives destinations, supports fan-out', async t => {
  const puts = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {
        Items: [
          {state: 'TX', city: 'Austin', rentalName: 'R1', _sk: 'TX|Austin|R1', size: 'big'},
          {state: 'TX', city: 'Austin', rentalName: 'R2', _sk: 'TX|Austin|R2', size: 'small'}
        ]
      };
    }
    if (n === 'GetCommand') {
      return {Item: {state: 'TX', city: 'Austin', _sk: 'TX|Austin', size: 'parent'}};
    }
    if (n === 'PutCommand') puts.push(cmd.input.Item);
    if (n === 'BatchWriteCommand') {
      for (const req of cmd.input.RequestItems[TABLE]) puts.push(req.PutRequest.Item);
    }
    return {};
  });
  await adapter.cloneAllUnderBy({state: 'TX', city: 'Austin'}, item => ({
    ...item,
    state: item.size === 'big' ? 'CA' : 'FL'
  }));
  const rentalPuts = puts.filter(p => p.rentalName);
  t.equal(rentalPuts.find(p => p.rentalName === 'R1').state, 'CA', 'big → CA');
  t.equal(rentalPuts.find(p => p.rentalName === 'R2').state, 'FL', 'small → FL');
});

test('moveAllUnder: descendants migrated via rename pattern, then self', async t => {
  const sent = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', city: 'Austin', rentalName: 'R1', _sk: 'TX|Austin|R1'}]};
    }
    if (n === 'GetCommand') {
      return {Item: {state: 'TX', city: 'Austin', _sk: 'TX|Austin'}};
    }
    return {};
  });
  const r = await adapter.moveAllUnder({state: 'TX', city: 'Austin'}, {state: 'TX', city: 'Dallas'});
  t.equal(r.processed, 2, 'descendant + self');
  const puts = sent.filter(c => c.constructor.name === 'PutCommand');
  const deletes = sent.filter(c => c.constructor.name === 'DeleteCommand');
  t.equal(puts.length, 2, 'two puts');
  t.equal(deletes.length, 2, 'two deletes (src)');
  t.ok(
    puts.every(p => p.input.Item.city === 'Dallas'),
    'city shifted'
  );
  t.ok(
    puts.every(p => p.input.ConditionExpression && /attribute_not_exists/.test(p.input.ConditionExpression)),
    'puts use ifNotExists'
  );
});

test('moveAllUnder: cursor from descendants → self deferred', async t => {
  const pages = [{Items: [{state: 'TX', city: 'Austin', rentalName: 'R1', _sk: 'TX|Austin|R1'}], LastEvaluatedKey: {_sk: 'TX|Austin|R1'}}, {Items: []}];
  let call = 0;
  const sent = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return pages[call++];
    return {};
  });
  const r = await adapter.moveAllUnder({state: 'TX', city: 'Austin'}, {state: 'TX', city: 'Dallas'}, {maxItems: 1});
  t.ok(r.cursor, 'cursor returned');
  t.equal(sent.filter(c => c.constructor.name === 'GetCommand').length, 0, 'self-move not started');
});

test('moveAllUnderBy: mapFn drives destinations', async t => {
  const puts = [];
  const {adapter} = makeCascadeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') {
      return {Items: [{state: 'TX', city: 'Austin', rentalName: 'R1', _sk: 'TX|Austin|R1'}]};
    }
    if (n === 'GetCommand') {
      return {Item: {state: 'TX', city: 'Austin', _sk: 'TX|Austin'}};
    }
    if (n === 'PutCommand') puts.push(cmd.input.Item);
    return {};
  });
  await adapter.moveAllUnderBy({state: 'TX', city: 'Austin'}, item => ({
    ...item,
    state: 'CA',
    city: 'LA'
  }));
  t.ok(
    puts.every(p => p.state === 'CA' && p.city === 'LA'),
    'mapFn-driven destinations'
  );
});

// --- editListByParams ---

test('editListByParams: updates per item, buckets no-ops as skipped', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand')
      return {
        Items: [
          {name: 'A', hp: 10},
          {name: 'B', hp: 20}
        ]
      };
    return {};
  });
  const r = await adapter.editListByParams({TableName: TABLE}, item => ({...item, hp: item.name === 'A' ? 100 : item.hp}));
  t.equal(r.processed, 1, 'only A changed');
  t.equal(r.skipped, 1, 'B unchanged → skipped');
  t.equal(r.failed.length, 0);
  const updates = sent.filter(c => c.constructor.name === 'UpdateCommand');
  t.equal(updates.length, 1);
});

test('editListByParams: mapFn falsy → skipped, not failed', async t => {
  const {adapter} = makeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: [{name: 'A', hp: 10}]};
    return {};
  });
  const r = await adapter.editListByParams({TableName: TABLE}, () => null);
  t.equal(r.processed, 0);
  t.equal(r.skipped, 1);
});

test('editListByParams: key-field change default → failed bucket (no throw)', async t => {
  const {adapter} = makeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand')
      return {
        Items: [
          {name: 'A', hp: 10},
          {name: 'B', hp: 20}
        ]
      };
    return {};
  });
  const r = await adapter.editListByParams({TableName: TABLE}, item => ({...item, name: item.name + '-new'}));
  t.equal(r.processed, 0);
  t.equal(r.failed.length, 2, 'both items rejected');
  t.matchString(r.failed[0].details || '', /key field/);
});

test('editListByParams: allowKeyChange auto-promotes to move per item', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: [{name: 'A', hp: 10}]};
    if (n === 'GetCommand') return {Item: {name: 'A', hp: 10}};
    return {};
  });
  const r = await adapter.editListByParams({TableName: TABLE}, item => ({...item, name: 'A-new'}), {allowKeyChange: true});
  t.equal(r.processed, 1);
  const txn = sent.find(c => c.constructor.name === 'TransactWriteCommand');
  t.ok(txn, 'emits TransactWriteCommand for the promoted move');
});

test('editListByParams: race-loss on CCF → skipped', async t => {
  const {adapter} = makeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: [{name: 'A', hp: 10}]};
    if (n === 'UpdateCommand') {
      const err = new Error('gone');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    return {};
  });
  const r = await adapter.editListByParams({TableName: TABLE}, item => ({...item, hp: 999}));
  t.equal(r.processed, 0);
  t.equal(r.skipped, 1, 'race-loss bucketed as skipped');
  t.equal(r.failed.length, 0);
});

test('editListByParams: ValidationException → failed bucket with classified reason', async t => {
  const {adapter} = makeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'QueryCommand' || n === 'ScanCommand') return {Items: [{name: 'A', hp: 10}]};
    if (n === 'UpdateCommand') {
      const err = new Error('bad');
      err.name = 'ValidationException';
      throw err;
    }
    return {};
  });
  const r = await adapter.editListByParams({TableName: TABLE}, item => ({...item, hp: 999}));
  t.equal(r.failed.length, 1);
  t.equal(r.failed[0].reason, 'ValidationException');
});

// --- resumable list mass ops (MassOpResult envelope) ---

test('deleteListByParams: returns MassOpResult envelope', async t => {
  const {adapter} = makeAdapter(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'BatchWriteCommand') return {UnprocessedItems: {}};
    return {Items: [{name: 'A'}, {name: 'B'}]};
  });
  const r = await adapter.deleteListByParams({TableName: TABLE});
  t.equal(r.processed, 2);
  t.equal(r.skipped, 0);
  t.deepEqual(r.failed, []);
  t.deepEqual(r.conflicts, []);
  t.equal(r.cursor, undefined);
});

test('cloneListByParams: returns MassOpResult envelope', async t => {
  const {adapter} = makeAdapter(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'BatchWriteCommand') return {UnprocessedItems: {}};
    return {Items: [{name: 'A'}]};
  });
  const r = await adapter.cloneListByParams({TableName: TABLE}, item => ({...item, name: item.name + '-copy'}));
  t.equal(r.processed, 1);
  t.deepEqual(r.failed, []);
  t.equal(r.cursor, undefined);
});

test('moveListByParams: returns MassOpResult envelope', async t => {
  const {adapter} = makeAdapter(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'BatchWriteCommand') return {UnprocessedItems: {}};
    return {Items: [{name: 'A'}]};
  });
  const r = await adapter.moveListByParams({TableName: TABLE}, item => ({...item, name: item.name + '-moved'}));
  t.equal(r.processed, 2, 'put + delete');
  t.equal(r.cursor, undefined);
});

test('deleteListByParams: maxItems stops at page boundary and emits cursor', async t => {
  const pages = [{Items: [{name: 'A'}, {name: 'B'}], LastEvaluatedKey: {name: 'B'}}, {Items: [{name: 'C'}, {name: 'D'}]}];
  let call = 0;
  const {adapter} = makeAdapter(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'BatchWriteCommand') return {UnprocessedItems: {}};
    return pages[call++];
  });
  const r = await adapter.deleteListByParams({TableName: TABLE}, {maxItems: 2});
  t.equal(r.processed, 2);
  t.ok(r.cursor, 'cursor emitted on truncation');
});

test('cloneListByParams: resumes from cursor', async t => {
  const {decodeCursor, encodeCursor} = await import('dynamodb-toolkit/mass');
  const seen = [];
  const {adapter} = makeAdapter(async cmd => {
    const n = cmd.constructor.name;
    if (n === 'BatchWriteCommand') return {UnprocessedItems: {}};
    const start = cmd.input.ExclusiveStartKey;
    if (start?.name === 'A') return {Items: [{name: 'B'}, {name: 'C'}]};
    seen.push('unexpected-initial');
    return {Items: []};
  });
  const token = encodeCursor({LastEvaluatedKey: {name: 'A'}});
  const r = await adapter.cloneListByParams({TableName: TABLE}, x => x, {resumeToken: token});
  t.equal(r.processed, 2);
  t.equal(r.cursor, undefined);
  t.notOk(decodeCursor(token).cursor);
});

test('Adapter: deprecated aliases forward to the new names (putAll / getAll / getAllByParams / deleteAllByParams / cloneAllByParams / moveAllByParams)', async t => {
  // The aliases emit console.warn once per process on first call; we don't
  // test the warning itself (module-level state makes ordering flaky) —
  // we test that the aliases route to the renamed methods.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const {adapter} = makeAdapter(async cmd => {
      const name = cmd.constructor.name;
      if (name === 'BatchWriteCommand') return {UnprocessedItems: {}};
      if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 0};
      if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [], Count: 0};
      return {};
    });
    t.ok(typeof adapter.getAll === 'function');
    t.ok(typeof adapter.getAllByParams === 'function');
    t.ok(typeof adapter.putAll === 'function');
    t.ok(typeof adapter.deleteAllByParams === 'function');
    t.ok(typeof adapter.cloneAllByParams === 'function');
    t.ok(typeof adapter.moveAllByParams === 'function');
    // Each one should succeed without throwing (routes to new name internally).
    const r1 = await adapter.getAll();
    t.equal(r1.data.length, 0);
    const r2 = await adapter.getAllByParams({TableName: 'TestTable'});
    t.equal(r2.data.length, 0);
    const r3 = await adapter.putAll([{name: 'x'}]);
    t.equal(r3.processed, 1);
    const r4 = await adapter.deleteAllByParams({TableName: 'TestTable'});
    t.equal(r4.processed, 0);
    const r5 = await adapter.cloneAllByParams({TableName: 'TestTable'}, x => x);
    t.equal(r5.processed, 0);
    const r6 = await adapter.moveAllByParams({TableName: 'TestTable'}, x => x);
    t.equal(r6.processed, 0);
  } finally {
    console.warn = origWarn;
  }
});

test('getListByParams: paginates and revives', async t => {
  const items = [
    {name: 'A', _x: 1},
    {name: 'B', _x: 2}
  ];
  const {adapter} = makeAdapter(
    async cmd => {
      if (cmd.input.Select === 'COUNT') return {Count: 0};
      return {Items: items, Count: 2};
    },
    {
      hooks: {
        revive: item => {
          const {_x, ...rest} = item;
          return rest;
        }
      }
    }
  );
  const r = await adapter.getListByParams({}, {offset: 0, limit: 10});
  t.equal(r.data.length, 2);
  t.notOk(r.data[0]._x, 'revive stripped');
});

test('getListByParams: needTotal:false omits total', async t => {
  const {adapter} = makeAdapter(async () => ({Items: [{name: 'A'}], Count: 1}));
  const r = await adapter.getListByParams({}, {offset: 0, limit: 10, needTotal: false});
  t.equal(r.total, undefined);
});

// --- clone / move ---

test('clone: getByKey + post', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'A', x: 1}};
    return {};
  });
  const result = await adapter.clone({name: 'A'}, item => ({...item, name: 'A-copy'}));
  t.deepEqual(result, {name: 'A-copy', x: 1});
  t.equal(sent[0].constructor.name, 'GetCommand');
  t.equal(sent[1].constructor.name, 'PutCommand');
});

test('clone: missing source returns undefined', async t => {
  const {adapter} = makeAdapter(async () => ({}));
  const result = await adapter.clone({name: 'Nowhere'}, item => item);
  t.equal(result, undefined);
});

test('move: get + put + delete via TransactWrite', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'GetCommand') return {Item: {name: 'A', x: 1}};
    return {};
  });
  const result = await adapter.move({name: 'A'}, item => ({...item, name: 'A-moved'}));
  t.deepEqual(result, {name: 'A-moved', x: 1});
  // GetCommand + TransactWriteCommand (put + delete bundled)
  t.equal(sent.length, 2);
  t.equal(sent[1].constructor.name, 'TransactWriteCommand');
  t.equal(sent[1].input.TransactItems.length, 2);
});

// --- adapter.buildKey (A1') ---

test('adapter.buildKey: single-field keyFields → equality', t => {
  const {adapter} = makeAdapter(async () => ({}));
  const p = adapter.buildKey({name: 'Hoth'});
  t.equal(p.KeyConditionExpression, '#kc0 = :kcv0');
  t.equal(p.ExpressionAttributeNames['#kc0'], 'name');
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'Hoth');
});

test('adapter.buildKey: composite default emits pk equality AND begins_with (children)', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  const p = adapter.buildKey({state: 'TX', rentalName: 'Dallas'});
  t.equal(p.KeyConditionExpression, '#kc0 = :kcv0 AND begins_with(#kc1, :kcv1)');
  t.equal(p.ExpressionAttributeNames['#kc0'], 'state');
  t.equal(p.ExpressionAttributeNames['#kc1'], '-sk');
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX');
  t.equal(p.ExpressionAttributeValues[':kcv1'], 'TX|Dallas|');
});

test('adapter.buildKey: {self: true} emits begins_with on base without trailing separator', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  const p = adapter.buildKey({state: 'TX', rentalName: 'Dallas'}, {self: true});
  t.equal(p.KeyConditionExpression, '#kc0 = :kcv0 AND begins_with(#kc1, :kcv1)');
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX');
  t.equal(p.ExpressionAttributeValues[':kcv1'], 'TX|Dallas');
});

test('adapter.buildKey: {partial} emits begins_with on base + sep + partial', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  const p = adapter.buildKey({state: 'TX'}, {partial: 'Dal'});
  t.equal(p.KeyConditionExpression, '#kc0 = :kcv0 AND begins_with(#kc1, :kcv1)');
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX');
  t.equal(p.ExpressionAttributeValues[':kcv1'], 'TX|Dal');
});

test('adapter.buildKey: {partial} takes precedence over {self} when both are set', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  const p = adapter.buildKey({state: 'TX'}, {self: true, partial: 'Dal'});
  t.equal(p.ExpressionAttributeValues[':kcv1'], 'TX|Dal', 'partial wins: no self-row begins_with');
});

test('adapter.buildKey: {partial} requires non-empty string', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  t.throws(() => adapter.buildKey({state: 'TX'}, {partial: ''}), 'partial empty');
});

test('adapter.buildKey: non-contiguous values throw', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  t.throws(() => adapter.buildKey({state: 'TX', carVin: 'V123'}), 'rentalName missing between state and carVin');
});

test('adapter.buildKey: missing partition key throws', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  t.throws(() => adapter.buildKey({rentalName: 'Dallas'}), 'state missing');
  t.throws(() => adapter.buildKey({}), 'empty values');
});

test('adapter.buildKey: number keyFields zero-padded per width', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', {name: 'rentalId', type: 'number', width: 5}, 'carVin'],
    structuralKey: {name: '-sk'}
  });
  // {self: true} omits the trailing separator so we can assert the
  // zero-padded base value directly.
  const p = adapter.buildKey({state: 'TX', rentalId: 42, carVin: 'V1'}, {self: true});
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX');
  t.equal(p.ExpressionAttributeValues[':kcv1'], 'TX|00042|V1');
});

test('adapter.buildKey: custom separator applied', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk', separator: '::'}
  });
  // {self: true} omits the trailing separator for a clean join assertion.
  const p = adapter.buildKey({state: 'TX', carVin: 'V1'}, {self: true});
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX');
  t.equal(p.ExpressionAttributeValues[':kcv1'], 'TX::V1');
});

test('adapter.buildKey: indexName option throws until declarative GSI surface lands', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.throws(() => adapter.buildKey({name: 'x'}, {indexName: 'by-name'}), 'indexName not supported yet');
});

test('adapter.buildKey: single-field keyFields + {self} or {partial} throws', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.throws(() => adapter.buildKey({name: 'x'}, {self: true}), '{self} needs structuralKey');
  t.throws(() => adapter.buildKey({name: 'x'}, {partial: 'abc'}), '{partial} needs structuralKey');
});

// --- canned mapFn builders ---

test('adapter.swapPrefix: rewrites leading keyFields prefix', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  const fn = adapter.swapPrefix({state: 'TX'}, {state: 'FL'});
  const out = fn({state: 'TX', rentalName: 'Dallas', carVin: 'V1', other: 'x'});
  t.deepEqual(out, {state: 'FL', rentalName: 'Dallas', carVin: 'V1', other: 'x'});
});

test('adapter.swapPrefix: multi-level prefix', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  const fn = adapter.swapPrefix({state: 'TX', rentalName: 'Dallas'}, {state: 'FL', rentalName: 'Miami'});
  const out = fn({state: 'TX', rentalName: 'Dallas', carVin: 'V1'});
  t.deepEqual(out, {state: 'FL', rentalName: 'Miami', carVin: 'V1'});
});

test('adapter.swapPrefix: throws when item does not match srcPrefix', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  const fn = adapter.swapPrefix({state: 'TX'}, {state: 'FL'});
  t.throws(() => fn({state: 'CA', carVin: 'V1'}), 'mismatched srcPrefix');
});

test('adapter.swapPrefix: prefixes must be contiguous-from-start', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  t.throws(() => adapter.swapPrefix({rentalName: 'Dallas'}, {rentalName: 'Miami'}), 'skipping state (not from start)');
});

test('adapter.swapPrefix: src and dst must name the same keys', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  t.throws(() => adapter.swapPrefix({state: 'TX'}, {state: 'FL', rentalName: 'Dallas'}), 'mismatched prefix lengths');
});

test('adapter.swapPrefix: non-object inputs throw', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.throws(() => adapter.swapPrefix(null, {name: 'x'}), 'null src');
  t.throws(() => adapter.swapPrefix({name: 'x'}, null), 'null dst');
  t.throws(() => adapter.swapPrefix({}, {}), 'empty prefixes');
});

test('adapter.overlayFields: merges overlay into item', t => {
  const {adapter} = makeAdapter(async () => ({}));
  const fn = adapter.overlayFields({archived: true, reason: 'cleanup'});
  const out = fn({name: 'Hoth', climate: 'frozen'});
  t.deepEqual(out, {name: 'Hoth', climate: 'frozen', archived: true, reason: 'cleanup'});
});

test('adapter.overlayFields: overlay wins over item values', t => {
  const {adapter} = makeAdapter(async () => ({}));
  const fn = adapter.overlayFields({climate: 'arctic'});
  const out = fn({name: 'Hoth', climate: 'frozen'});
  t.equal(out.climate, 'arctic');
});

test('adapter.overlayFields: touching a keyField shifts it', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  const fn = adapter.overlayFields({state: 'FL'});
  const out = fn({state: 'TX', rentalName: 'Dallas'});
  t.equal(out.state, 'FL');
  t.equal(out.rentalName, 'Dallas');
});

test('adapter.overlayFields: rejects overlay that nulls a keyField', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.throws(() => adapter.overlayFields({name: undefined}), 'undefined keyField');
  t.throws(() => adapter.overlayFields({name: null}), 'null keyField');
});

test('adapter.overlayFields: snapshots overlay (later caller mutation does not leak)', t => {
  const {adapter} = makeAdapter(async () => ({}));
  const overlay = {tag: 'a'};
  const fn = adapter.overlayFields(overlay);
  overlay.tag = 'b';
  const out = fn({name: 'x'});
  t.equal(out.tag, 'a', 'frozen snapshot');
});

test('adapter.overlayFields: non-object input throws', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.throws(() => adapter.overlayFields(null), 'null');
  t.throws(() => adapter.overlayFields('a'), 'string');
});

// --- technicalPrefix + built-in prepare / revive steps ---

test('Adapter: technicalPrefix validation — non-string rejected', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], technicalPrefix: 42}), 'non-string');
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], technicalPrefix: ''}), 'empty string');
});

test('Adapter: technicalPrefix requires structuralKey.name to start with it', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['state', 'carVin'],
        structuralKey: {name: 'sk'}, // does not start with '-'
        technicalPrefix: '-'
      }),
    'structuralKey.name without prefix'
  );
});

test('Adapter: technicalPrefix requires searchablePrefix to start with it (when searchable declared)', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['name'],
        searchable: {name: 1},
        searchablePrefix: 'search-', // does not start with '-'
        technicalPrefix: '-'
      }),
    'searchablePrefix without prefix'
  );
});

test('Adapter: technicalPrefix unset → built-in steps are no-ops (back-compat)', t => {
  const {adapter} = makeAdapter(async () => ({}));
  // No technicalPrefix — prepare is identity (default hook), revive is identity+subsetObject.
  const prepared = adapter.hooks.prepare({name: 'Hoth', climate: 'frozen'});
  t.deepEqual(prepared, {name: 'Hoth', climate: 'frozen'}, 'no built-in rewrite');
  const revived = adapter.hooks.revive({name: 'Hoth', climate: 'frozen', '-search-name': 'hoth'});
  t.deepEqual(revived, {name: 'Hoth', climate: 'frozen', '-search-name': 'hoth'}, 'no stripping');
});

test('built-in prepare: rejects incoming fields starting with technicalPrefix', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], technicalPrefix: '-'});
  t.throws(() => adapter.hooks.prepare({name: 'x', '-evil': 1}), 'incoming -prefixed field');
});

test('built-in prepare: computes structural key from composite keyFields', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'},
    technicalPrefix: '-'
  });
  const out = adapter.hooks.prepare({state: 'TX', rentalName: 'Dallas', carVin: 'V1', extra: 'x'});
  t.equal(out['-sk'], 'TX|Dallas|V1');
  t.equal(out.state, 'TX', 'original fields preserved');
  t.equal(out.extra, 'x', 'non-key fields pass through');
});

test('built-in prepare: structural key uses contiguous-from-start rule', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'},
    technicalPrefix: '-'
  });
  // Only state present → -sk = 'TX' (depth 1)
  const out1 = adapter.hooks.prepare({state: 'TX'});
  t.equal(out1['-sk'], 'TX');
  // State + rentalName → -sk = 'TX|Dallas' (depth 2)
  const out2 = adapter.hooks.prepare({state: 'TX', rentalName: 'Dallas'});
  t.equal(out2['-sk'], 'TX|Dallas');
});

test('built-in prepare: number keyFields zero-padded per width', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', {name: 'rentalId', type: 'number', width: 5}, 'carVin'],
    structuralKey: {name: '-sk'},
    technicalPrefix: '-'
  });
  const out = adapter.hooks.prepare({state: 'TX', rentalId: 42, carVin: 'V1'});
  t.equal(out['-sk'], 'TX|00042|V1');
});

test('built-in prepare: single-field keyFields skips structural-key computation', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], technicalPrefix: '-'});
  const out = adapter.hooks.prepare({name: 'Hoth'});
  t.equal(out['-sk'], undefined, 'no structural key for single-field keyFields');
  t.equal(out.name, 'Hoth');
});

test('built-in prepare: patch skips structural-key write (primary-key immutable)', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk'},
    technicalPrefix: '-'
  });
  const out = adapter.hooks.prepare({climate: 'arctic'}, true /* isPatch */);
  t.equal(out['-sk'], undefined, 'no structural key on patch');
  t.equal(out.climate, 'arctic');
});

test('built-in prepare: writes searchable mirrors lowercase', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    searchable: {name: 1, climate: 1},
    technicalPrefix: '-'
  });
  const out = adapter.hooks.prepare({name: 'Hoth', climate: 'FROZEN'});
  t.equal(out['-search-name'], 'hoth');
  t.equal(out['-search-climate'], 'frozen');
});

test('built-in prepare: searchable mirrors written on patches too', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    searchable: {name: 1},
    technicalPrefix: '-'
  });
  const out = adapter.hooks.prepare({name: 'Tatooine'}, true /* isPatch */);
  t.equal(out['-search-name'], 'tatooine');
});

test('built-in revive: strips all fields starting with technicalPrefix', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk'},
    technicalPrefix: '-'
  });
  const revived = adapter.hooks.revive({
    state: 'TX',
    carVin: 'V1',
    climate: 'dry',
    '-sk': 'TX|V1',
    '-search-carVin': 'v1'
  });
  t.equal(revived.state, 'TX');
  t.equal(revived.carVin, 'V1');
  t.equal(revived.climate, 'dry');
  t.equal(revived['-sk'], undefined, '-sk stripped');
  t.equal(revived['-search-carVin'], undefined, 'search mirror stripped');
});

test('built-in prepare / revive compose with user hooks (run before user)', t => {
  const client = makeMockClient(async () => ({}));
  let prepareCalledWith, reviveCalledWith;
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk'},
    technicalPrefix: '-',
    hooks: {
      prepare: item => {
        prepareCalledWith = item;
        return {...item, _userFlag: true};
      },
      revive: rawItem => {
        reviveCalledWith = rawItem;
        return {...rawItem, _reviveFlag: true};
      }
    }
  });

  const prepared = adapter.hooks.prepare({state: 'TX', carVin: 'V1'});
  // User's prepare sees the post-built-in item (with -sk written).
  t.equal(prepareCalledWith['-sk'], 'TX|V1', 'user hook sees structural key');
  t.equal(prepared._userFlag, true, 'user hook ran after built-in');

  const revived = adapter.hooks.revive({state: 'TX', carVin: 'V1', '-sk': 'TX|V1'});
  // User's revive sees the post-built-in item (with -sk stripped).
  t.equal(reviveCalledWith['-sk'], undefined, 'user hook sees stripped item');
  t.equal(revived._reviveFlag, true, 'user hook ran after built-in');
});

// --- indices declaration ---

test('Adapter: indices — gsi with bare-string pk', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'by-status': {type: 'gsi', pk: 'status'}
    }
  });
  t.deepEqual(adapter.indices['by-status'], {
    type: 'gsi',
    pk: {name: 'status', type: 'string'},
    projection: 'all',
    sparse: false,
    indirect: false
  });
});

test('Adapter: indices — gsi with pk + sk + typed', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'by-status-date': {
        type: 'gsi',
        pk: 'status',
        sk: {name: 'createdAt', type: 'number'},
        projection: 'all'
      }
    }
  });
  t.deepEqual(adapter.indices['by-status-date'].sk, {name: 'createdAt', type: 'number'});
});

test('Adapter: indices — gsi requires pk', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], indices: {bad: {type: 'gsi'}}}), 'gsi without pk');
});

test('Adapter: indices — lsi requires sk', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], indices: {bad: {type: 'lsi'}}}), 'lsi without sk');
});

test('Adapter: indices — lsi rejects pk declaration', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['name'],
        indices: {'by-alt': {type: 'lsi', pk: 'name', sk: 'altField'}}
      }),
    'lsi with pk'
  );
});

test('Adapter: indices — lsi with sk only', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'by-alt': {type: 'lsi', sk: {name: 'altField', type: 'string'}}
    }
  });
  t.equal(adapter.indices['by-alt'].type, 'lsi');
  t.deepEqual(adapter.indices['by-alt'].sk, {name: 'altField', type: 'string'});
  t.equal(adapter.indices['by-alt'].pk, undefined);
});

test('Adapter: indices — string pk/sk shorthand expands to {name, type: "string"}', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'by-status-createdAt': {type: 'gsi', pk: 'status', sk: '_createdAt'},
      'by-sort': {type: 'lsi', sk: 'altField'}
    }
  });
  t.deepEqual(adapter.indices['by-status-createdAt'].pk, {name: 'status', type: 'string'});
  t.deepEqual(adapter.indices['by-status-createdAt'].sk, {name: '_createdAt', type: 'string'});
  t.deepEqual(adapter.indices['by-sort'].sk, {name: 'altField', type: 'string'});
});

test('Adapter: indices — rejects unknown type', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['name'],
        indices: {bad: {type: 'other', pk: 'x'}}
      }),
    'unknown type'
  );
});

test('Adapter: indices — projection defaults to all', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {x: {type: 'gsi', pk: 'foo'}}
  });
  t.equal(adapter.indices['x'].projection, 'all');
});

test('Adapter: indices — projection accepts keys-only / include array', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'keys-only-idx': {type: 'gsi', pk: 'a', projection: 'keys-only'},
      'include-idx': {type: 'gsi', pk: 'b', projection: ['x', 'y']}
    }
  });
  t.equal(adapter.indices['keys-only-idx'].projection, 'keys-only');
  t.deepEqual(adapter.indices['include-idx'].projection, ['x', 'y']);
});

test('Adapter: indices — rejects invalid projection', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['name'],
        indices: {x: {type: 'gsi', pk: 'a', projection: 'nonsense'}}
      }),
    'unknown projection'
  );
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['name'],
        indices: {x: {type: 'gsi', pk: 'a', projection: []}}
      }),
    'empty projection array'
  );
});

test('Adapter: indices — sparse true/false/object', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      a: {type: 'gsi', pk: 'a', sparse: true},
      b: {type: 'gsi', pk: 'b'},
      c: {type: 'gsi', pk: 'c', sparse: {onlyWhen: item => !!item.active}}
    }
  });
  t.equal(adapter.indices['a'].sparse, true);
  t.equal(adapter.indices['b'].sparse, false);
  t.equal(typeof adapter.indices['c'].sparse.onlyWhen, 'function');
});

test('Adapter: indices — rejects invalid sparse', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['name'],
        indices: {x: {type: 'gsi', pk: 'a', sparse: 'yes'}}
      }),
    'string sparse'
  );
});

test('Adapter: indices — indirect flag', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      thin: {type: 'gsi', pk: 'a', projection: 'keys-only', indirect: true}
    }
  });
  t.equal(adapter.indices['thin'].indirect, true);
});

test('Adapter: indices — legacy indirectIndices synthesized into indices map', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indirectIndices: {'legacy-idx': 1}
  });
  t.equal(adapter.indices['legacy-idx'].type, 'gsi');
  t.equal(adapter.indices['legacy-idx'].indirect, true);
  t.equal(adapter.indices['legacy-idx'].projection, 'keys-only');
  // pk/sk remain undefined for legacy-only entries — no metadata available.
  t.equal(adapter.indices['legacy-idx'].pk, undefined);
});

test('Adapter: indices — legacy indirectIndices marks existing entry as indirect', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'my-idx': {type: 'gsi', pk: 'status', projection: 'keys-only'}
    },
    indirectIndices: {'my-idx': 1}
  });
  t.equal(adapter.indices['my-idx'].indirect, true, 'legacy marker promoted to indirect');
  t.deepEqual(adapter.indices['my-idx'].pk, {name: 'status', type: 'string'}, 'original pk preserved');
});

test('Adapter: indices — _isIndirect reads from indices', async t => {
  const client = makeMockClient(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 1};
    if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [{name: 'X'}], Count: 1};
    if (name === 'BatchGetCommand') {
      return {Responses: {T: [{name: 'X', climate: 'frozen'}]}, UnprocessedKeys: {}};
    }
    return {};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      thin: {type: 'gsi', pk: 'status', projection: 'keys-only', indirect: true}
    }
  });
  const result = await adapter.getListByParams({IndexName: 'thin'});
  t.equal(result.data[0]?.climate, 'frozen', 'second-hop BatchGet happened (indirect=true)');
});

// --- primaryKeyAttrs + built-in prepareKey + composite-keyFields DB-key shape ---

test('Adapter: primaryKeyAttrs — single-field keyFields uses just that name', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.deepEqual(adapter.primaryKeyAttrs, ['name']);
});

test('Adapter: primaryKeyAttrs — composite keyFields uses [pk, structuralKey.name]', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  t.deepEqual(adapter.primaryKeyAttrs, ['state', '-sk']);
});

test('built-in prepareKey: pass-through when structuralKey not declared', t => {
  const {adapter} = makeAdapter(async () => ({}));
  const key = adapter.hooks.prepareKey({name: 'Hoth'});
  t.deepEqual(key, {name: 'Hoth'});
});

test('built-in prepareKey: composes structural key from keyFields values', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  const key = adapter.hooks.prepareKey({state: 'TX', rentalName: 'Dallas', carVin: 'V1'});
  t.equal(key['-sk'], 'TX|Dallas|V1');
  t.equal(key.state, 'TX', 'keyFields components preserved');
});

test('built-in prepareKey: contiguous-from-start stops at first missing field', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  // Just state → depth 1 → -sk = 'TX'
  const key = adapter.hooks.prepareKey({state: 'TX'});
  t.equal(key['-sk'], 'TX');
});

test('built-in prepareKey: number keyFields zero-padded', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', {name: 'rentalId', type: 'number', width: 5}, 'carVin'],
    structuralKey: {name: '-sk'}
  });
  const key = adapter.hooks.prepareKey({state: 'TX', rentalId: 42, carVin: 'V1'});
  t.equal(key['-sk'], 'TX|00042|V1');
});

test('built-in prepareKey: GSI-targeted read is pass-through', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'},
    indices: {'by-name': {type: 'gsi', pk: 'rentalName'}}
  });
  const key = adapter.hooks.prepareKey({rentalName: 'Dallas'}, 'by-name');
  t.equal(key['-sk'], undefined, 'no structural-key composition on index reads');
  t.equal(key.rentalName, 'Dallas');
});

test('_restrictKey: composite keyFields returns {pk, sk} — not keyFields-shaped', async t => {
  let getCmd;
  const client = makeMockClient(async cmd => {
    getCmd = cmd;
    return {Item: {state: 'TX', '-sk': 'TX|Dallas|V1', climate: 'dry'}};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  await adapter.getByKey({state: 'TX', rentalName: 'Dallas', carVin: 'V1'});
  // DynamoDB Key should have just primary-key attrs — not rentalName/carVin.
  t.deepEqual(Object.keys(getCmd.input.Key).sort(), ['-sk', 'state']);
  t.equal(getCmd.input.Key.state, 'TX');
  t.equal(getCmd.input.Key['-sk'], 'TX|Dallas|V1');
});

test('composite keyFields: full round-trip through the hooks wrapping', async t => {
  // prepare writes -sk; revive strips it (because technicalPrefix '-').
  // The caller sees just their keyFields.
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    const name = cmd.constructor.name;
    if (name === 'GetCommand') {
      return {Item: {state: 'TX', '-sk': 'TX|Dallas|V1', carVin: 'V1', rentalName: 'Dallas', climate: 'dry'}};
    }
    return {};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'},
    technicalPrefix: '-'
  });
  // Write: -sk is auto-computed, item sent to Put includes it.
  await adapter.put({state: 'TX', rentalName: 'Dallas', carVin: 'V1', climate: 'dry'}, {force: true});
  const putCmd = sent.find(c => c.constructor.name === 'PutCommand');
  t.equal(putCmd.input.Item['-sk'], 'TX|Dallas|V1', 'structural key written');
  // Read: hooks.revive strips -sk; caller sees their keyFields only.
  const item = await adapter.getByKey({state: 'TX', rentalName: 'Dallas', carVin: 'V1'});
  t.equal(item['-sk'], undefined, 'technical field stripped on revive');
  t.equal(item.climate, 'dry');
  t.equal(item.state, 'TX');
});

// --- string shorthands for structuralKey / typeDiscriminator ---

test('Adapter: structuralKey string shorthand expands to {name, separator: "|"}', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: '-sk'
  });
  t.deepEqual(adapter.structuralKey, {name: '-sk', separator: '|'});
});

test('Adapter: structuralKey empty-string shorthand throws', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['state', 'carVin'], structuralKey: ''}), 'empty');
});

test('Adapter: structuralKey invalid shape throws', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['state', 'carVin'], structuralKey: 42}), 'number');
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['state', 'carVin'], structuralKey: {}}), 'missing name');
});

test('Adapter: typeDiscriminator string shorthand expands to {name}', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: '-sk',
    typeDiscriminator: 'kind'
  });
  t.deepEqual(adapter.typeDiscriminator, {name: 'kind'});
});

test('Adapter: typeDiscriminator empty-string shorthand throws', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(
    () =>
      new Adapter({
        client,
        table: 'T',
        keyFields: ['state', 'carVin'],
        structuralKey: '-sk',
        typeDiscriminator: ''
      }),
    'empty string'
  );
});

// --- ConsistentReadOnGSIRejected ---

test('getListByParams: refuses ConsistentRead on declared GSI', async t => {
  const client = makeMockClient(async () => ({Items: [], Count: 0}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'by-status': {type: 'gsi', pk: 'status'}
    }
  });
  // Strong-consistent read on a GSI should throw ConsistentReadOnGSIRejected.
  let threw;
  try {
    await adapter.getListByParams({TableName: 'T', IndexName: 'by-status', ConsistentRead: true});
  } catch (err) {
    threw = err;
  }
  t.ok(threw, 'throws');
  t.equal(threw.name, 'ConsistentReadOnGSIRejected');
  t.equal(threw.indexName, 'by-status');
});

test('getListByParams: allows ConsistentRead on declared LSI', async t => {
  const client = makeMockClient(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 0};
    if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [], Count: 0};
    return {};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk',
    indices: {
      'by-alt': {type: 'lsi', sk: 'altSort'}
    }
  });
  // Should NOT throw — LSI supports strong consistency.
  await adapter.getListByParams({TableName: 'T', IndexName: 'by-alt', ConsistentRead: true});
  t.ok(true, 'LSI consistent read allowed');
});

test('getListByParams: allows ConsistentRead on base table (no IndexName)', async t => {
  const client = makeMockClient(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 0};
    if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [], Count: 0};
    return {};
  });
  const adapter = new Adapter({client, table: 'T', keyFields: ['name']});
  await adapter.getListByParams({TableName: 'T', ConsistentRead: true});
  t.ok(true, 'base-table consistent read allowed');
});

test('getListByParams: defers to DynamoDB for undeclared indices (legacy/unknown)', async t => {
  const client = makeMockClient(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 0};
    if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [], Count: 0};
    return {};
  });
  const adapter = new Adapter({client, table: 'T', keyFields: ['name']});
  // Unknown index — toolkit doesn't know if it's a GSI or LSI; no refusal here.
  // (DynamoDB will reject if it's actually a GSI.)
  await adapter.getListByParams({TableName: 'T', IndexName: 'unknown-idx', ConsistentRead: true});
  t.ok(true, 'undeclared index: no local refusal');
});

// --- findIndexForSort + sort-to-index inference ---

test('adapter.findIndexForSort: picks declared GSI by sk.name', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'by-status': {type: 'gsi', pk: 'status', sk: 'createdAt'}
    }
  });
  t.equal(adapter.findIndexForSort('createdAt'), 'by-status');
});

test('adapter.findIndexForSort: prefers LSI over GSI when both match', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk',
    indices: {
      'by-foo-gsi': {type: 'gsi', pk: 'bucket', sk: 'altField'},
      'by-foo-lsi': {type: 'lsi', sk: 'altField'}
    }
  });
  t.equal(adapter.findIndexForSort('altField'), 'by-foo-lsi');
});

test('adapter.findIndexForSort: throws NoIndexForSortField on miss', t => {
  const {adapter} = makeAdapter(async () => ({}));
  let threw;
  try {
    adapter.findIndexForSort('missing');
  } catch (err) {
    threw = err;
  }
  t.ok(threw);
  t.equal(threw.name, 'NoIndexForSortField');
  t.equal(threw.sortField, 'missing');
});

test('getList: options.sort → resolves to index automatically', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    const name = cmd.constructor.name;
    if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 0};
    if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [], Count: 0};
    return {};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'by-status': {type: 'gsi', pk: 'status', sk: 'createdAt'}
    }
  });
  await adapter.getList({sort: 'createdAt'});
  const queryCmd = sent.find(c => (c.constructor.name === 'QueryCommand' || c.constructor.name === 'ScanCommand') && c.input?.Select !== 'COUNT');
  t.equal(queryCmd?.input?.IndexName, 'by-status');
});

test('getList: options.useIndex overrides sort inference', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    const name = cmd.constructor.name;
    if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 0};
    if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [], Count: 0};
    return {};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    indices: {
      'by-status': {type: 'gsi', pk: 'status', sk: 'createdAt'},
      'legacy-idx': {type: 'gsi', pk: 'bucket'}
    }
  });
  // sort='createdAt' would pick by-status, but useIndex forces legacy-idx.
  await adapter.getList({sort: 'createdAt', useIndex: 'legacy-idx'});
  const queryCmd = sent.find(c => (c.constructor.name === 'QueryCommand' || c.constructor.name === 'ScanCommand') && c.input?.Select !== 'COUNT');
  t.equal(queryCmd?.input?.IndexName, 'legacy-idx');
});

test('getList: unmapped sort throws NoIndexForSortField', async t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name']});
  let threw;
  try {
    await adapter.getList({sort: 'createdAt'});
  } catch (err) {
    threw = err;
  }
  t.ok(threw);
  t.equal(threw.name, 'NoIndexForSortField');
});

// --- keysOnly + *keys wildcard ---

test('getList: keysOnly: true projects only keyFields', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    const name = cmd.constructor.name;
    if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 0};
    if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [], Count: 0};
    return {};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk'
  });
  await adapter.getList({keysOnly: true});
  const queryCmd = sent.find(c => (c.constructor.name === 'QueryCommand' || c.constructor.name === 'ScanCommand') && c.input?.Select !== 'COUNT');
  // ProjectionExpression should reference keyFields attrs.
  t.ok(queryCmd?.input?.ProjectionExpression);
  // Each keyField name should be in the EAN map pointing to itself.
  const names = Object.values(queryCmd.input.ExpressionAttributeNames || {});
  t.ok(names.includes('state'));
  t.ok(names.includes('rentalName'));
});

test('getList: keysOnly takes precedence over fields', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    const name = cmd.constructor.name;
    if (name === 'QueryCommand' && cmd.input?.Select === 'COUNT') return {Count: 0};
    if (name === 'QueryCommand' || name === 'ScanCommand') return {Items: [], Count: 0};
    return {};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk'
  });
  await adapter.getList({keysOnly: true, fields: ['climate']});
  const queryCmd = sent.find(c => (c.constructor.name === 'QueryCommand' || c.constructor.name === 'ScanCommand') && c.input?.Select !== 'COUNT');
  const names = Object.values(queryCmd.input.ExpressionAttributeNames || {});
  // keysOnly wins — climate should NOT be in the projection.
  t.notOk(names.includes('climate'), 'fields ignored when keysOnly is true');
  t.ok(names.includes('state'));
  t.ok(names.includes('rentalName'));
});

// --- filterable declaration + applyFilter ---

test('Adapter: filterable — validates shape + ops', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], filterable: 'x'}), 'non-object');
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: []}}), 'empty ops array');
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['unknown']}}), 'invalid op');
});

test('Adapter: filterable stored normalized', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    filterable: {status: ['eq', 'ne', 'in'], cost: ['gt', 'lt']}
  });
  t.deepEqual(adapter.filterable.status, ['eq', 'ne', 'in']);
  t.deepEqual(adapter.filterable.cost, ['gt', 'lt']);
});

test('applyFilter: throws BadFilterField for unlisted field', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['eq']}});
  let threw;
  try {
    adapter.applyFilter({}, [{field: 'unknown', op: 'eq', value: 'x'}]);
  } catch (err) {
    threw = err;
  }
  t.ok(threw);
  t.equal(threw.name, 'BadFilterField');
});

test('applyFilter: throws BadFilterOp when op not in allowlist', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['eq']}});
  let threw;
  try {
    adapter.applyFilter({}, [{field: 'status', op: 'ne', value: 'x'}]);
  } catch (err) {
    threw = err;
  }
  t.ok(threw);
  t.equal(threw.name, 'BadFilterOp');
});

test('applyFilter: comparison op → FilterExpression', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['eq']}});
  const p = adapter.applyFilter({}, [{field: 'status', op: 'eq', value: 'active'}]);
  t.matchString(p.FilterExpression, /#ff0 = :ffv0/);
  t.equal(p.ExpressionAttributeNames['#ff0'], 'status');
  t.equal(p.ExpressionAttributeValues[':ffv0'], 'active');
});

test('applyFilter: eq on partition key auto-promotes to KeyConditionExpression', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state'],
    filterable: {state: ['eq']}
  });
  const p = adapter.applyFilter({}, [{field: 'state', op: 'eq', value: 'TX'}]);
  t.matchString(p.KeyConditionExpression, /#ff0 = :ffv0/);
  t.equal(p.FilterExpression, undefined, 'pk goes to KC, not FE');
});

test('applyFilter: beg on structural-key sort-key auto-promotes', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk',
    filterable: {'-sk': ['beg']}
  });
  const p = adapter.applyFilter({}, [{field: '-sk', op: 'beg', value: 'TX|Dallas|'}]);
  t.matchString(p.KeyConditionExpression, /begins_with\(#ff0, :ffv0\)/);
});

test('applyFilter: comparison op on sort key auto-promotes to KeyCondition', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk',
    filterable: {'-sk': ['lt', 'le', 'gt', 'ge']}
  });
  for (const op of ['lt', 'le', 'gt', 'ge']) {
    const p = adapter.applyFilter({}, [{field: '-sk', op, value: 'TX|Dallas'}]);
    t.ok(p.KeyConditionExpression, 'sort-key comparison goes to KC not FE');
    t.equal(p.FilterExpression, undefined);
  }
});

test('applyFilter: second sort-key clause falls back to FilterExpression', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk',
    filterable: {'-sk': ['gt', 'lt']}
  });
  const p = adapter.applyFilter({}, [
    {field: '-sk', op: 'gt', value: 'TX|A'},
    {field: '-sk', op: 'lt', value: 'TX|Z'}
  ]);
  t.ok(p.KeyConditionExpression, 'first sk clause promoted');
  t.matchString(p.KeyConditionExpression, /#ff0 > :ffv0/);
  t.ok(p.FilterExpression, 'second sk clause falls to FE (KCE allows one per component)');
  t.matchString(p.FilterExpression, /#ff1 < :ffv1/);
});

test('applyFilter: second pk clause falls back to FilterExpression', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state'],
    filterable: {state: ['eq']}
  });
  const p = adapter.applyFilter({}, [
    {field: 'state', op: 'eq', value: 'TX'},
    {field: 'state', op: 'eq', value: 'CA'}
  ]);
  t.ok(p.KeyConditionExpression, 'first pk clause promoted');
  t.ok(p.FilterExpression, 'duplicate pk clause falls to FE');
});

test('applyFilter: btw requires exactly 2 values', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {cost: ['btw']}});
  t.throws(() => adapter.applyFilter({}, [{field: 'cost', op: 'btw', value: ['1']}]));
  t.throws(() => adapter.applyFilter({}, [{field: 'cost', op: 'btw', value: ['1', '2', '3']}]));
});

test('applyFilter: btw with 2 values emits BETWEEN', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {cost: ['btw']}});
  const p = adapter.applyFilter({}, [{field: 'cost', op: 'btw', value: ['10', '20']}]);
  t.matchString(p.FilterExpression, /#ff0 BETWEEN :ffv0 AND :ffv1/);
});

test('applyFilter: in op emits IN with N placeholders', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {tag: ['in']}});
  const p = adapter.applyFilter({}, [{field: 'tag', op: 'in', value: ['a', 'b', 'c']}]);
  t.matchString(p.FilterExpression, /#ff0 IN \(:ffv0, :ffv1, :ffv2\)/);
});

test('applyFilter: ex / nx emit attribute_exists / attribute_not_exists (no `value` in clause)', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['ex', 'nx']}});
  const pEx = adapter.applyFilter({}, [{field: 'status', op: 'ex'}]);
  t.matchString(pEx.FilterExpression, /attribute_exists\(#ff0\)/);
  const pNx = adapter.applyFilter({}, [{field: 'status', op: 'nx'}]);
  t.matchString(pNx.FilterExpression, /attribute_not_exists\(#ff0\)/);
});

test('applyFilter: ct emits contains()', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {tags: ['ct']}});
  const p = adapter.applyFilter({}, [{field: 'tags', op: 'ct', value: 'vip'}]);
  t.matchString(p.FilterExpression, /contains\(#ff0, :ffv0\)/);
});

test('applyFilter: number-type fields coerced', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: [{name: 'id', type: 'number'}],
    filterable: {id: ['eq']}
  });
  const p = adapter.applyFilter({}, [{field: 'id', op: 'eq', value: '42'}]);
  t.equal(p.ExpressionAttributeValues[':ffv0'], 42, 'string "42" coerced to 42');
});

test('applyFilter: bad number coercion throws', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: [{name: 'id', type: 'number'}],
    filterable: {id: ['eq']}
  });
  t.throws(() => adapter.applyFilter({}, [{field: 'id', op: 'eq', value: 'abc'}]));
});

test('applyFilter: multiple clauses AND-combined', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    filterable: {status: ['eq'], climate: ['ne']}
  });
  const p = adapter.applyFilter({}, [
    {field: 'status', op: 'eq', value: 'active'},
    {field: 'climate', op: 'ne', value: 'hot'}
  ]);
  t.matchString(p.FilterExpression, /#ff0 = :ffv0 AND #ff1 <> :ffv1/);
});

// --- E6: filterable {ops, type?} shape ---

test('Adapter: filterable {ops, type} shape accepted alongside [ops]', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    filterable: {
      year: {ops: ['eq', 'ge', 'le', 'btw'], type: 'number'},
      status: ['eq', 'ne']
    }
  });
  t.deepEqual(adapter.filterable.year, ['eq', 'ge', 'le', 'btw']);
  t.deepEqual(adapter.filterable.status, ['eq', 'ne']);
  t.equal(adapter.filterableTypes.year, 'number');
  t.equal(adapter.filterableTypes.status, undefined);
});

test('Adapter: filterable {ops, type} coerces filter values to the declared type', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    filterable: {year: {ops: ['eq'], type: 'number'}}
  });
  const p = adapter.applyFilter({}, [{field: 'year', op: 'eq', value: '2024'}]);
  t.equal(p.ExpressionAttributeValues[':ffv0'], 2024, 'string "2024" coerced to number via filterable.type');
});

test('Adapter: filterable rejects invalid {ops, type} shapes', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], filterable: {year: {ops: ['eq'], type: 'date'}}}), 'bad type');
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], filterable: {year: {ops: 'eq'}}}), 'ops must be array');
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], filterable: {year: {type: 'number'}}}), 'ops required');
});

// --- E5: adapter.getListUnder sugar ---

test('adapter.getListUnder: equivalent to getListByParams(buildKey(key))', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    if (cmd.input?.Select === 'COUNT') return {Count: 0};
    return {Items: [], Count: 0};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk'
  });
  await adapter.getListUnder({state: 'TX'});
  const queryCmd = sent.find(c => c.constructor.name === 'QueryCommand' && c.input?.Select !== 'COUNT');
  t.ok(queryCmd, 'dispatched a Query');
  // Children-default: begins_with on base + trailing separator.
  t.matchString(queryCmd.input.KeyConditionExpression, /begins_with/);
  t.equal(
    queryCmd.input.ExpressionAttributeValues[
      Object.keys(queryCmd.input.ExpressionAttributeValues).find(k => queryCmd.input.ExpressionAttributeValues[k] === 'TX|')
    ],
    'TX|'
  );
});

// --- E2: hide descriptor record from list ops ---

test('Adapter: descriptorKey injects NOT (<pk> = :descriptorKey) on list ops', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    if (cmd.input?.Select === 'COUNT') return {Count: 0};
    return {Items: [], Count: 0};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    descriptorKey: '__adapter__'
  });
  await adapter.getListByParams({TableName: 'T'});
  const scanCmd = sent.find(c => c.constructor.name === 'ScanCommand' && c.input?.Select !== 'COUNT');
  t.matchString(scanCmd.input.FilterExpression, /<>/, 'emits a <> clause');
  const descriptorValue = Object.values(scanCmd.input.ExpressionAttributeValues || {}).find(v => v === '__adapter__');
  t.equal(descriptorValue, '__adapter__', 'descriptor value in placeholders');
});

test('Adapter: descriptorKey honors {includeDescriptor: true} escape hatch', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    if (cmd.input?.Select === 'COUNT') return {Count: 0};
    return {Items: [], Count: 0};
  });
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    descriptorKey: '__adapter__'
  });
  await adapter.getListByParams({TableName: 'T'}, {includeDescriptor: true});
  const scanCmd = sent.find(c => c.constructor.name === 'ScanCommand' && c.input?.Select !== 'COUNT');
  t.notOk(scanCmd.input.FilterExpression, 'no injected filter when includeDescriptor is true');
});

test('Adapter: no descriptor filter when descriptorKey is absent', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    if (cmd.input?.Select === 'COUNT') return {Count: 0};
    return {Items: [], Count: 0};
  });
  const adapter = new Adapter({client, table: 'T', keyFields: ['name']});
  await adapter.getListByParams({TableName: 'T'});
  const scanCmd = sent.find(c => c.constructor.name === 'ScanCommand' && c.input?.Select !== 'COUNT');
  t.notOk(scanCmd.input.FilterExpression, 'no injected filter when descriptorKey unset');
});

// --- E3: stamp hook builders ---

test('stampCreatedAtISO: stamps on first insert, leaves patches and round-trips alone', async t => {
  const {stampCreatedAtISO} = await import('dynamodb-toolkit');
  const prepare = stampCreatedAtISO();
  const now = new Date();
  const stamped = prepare({name: 'A'}, false);
  t.ok(stamped._createdAt, 'first insert gets _createdAt');
  t.ok(new Date(stamped._createdAt).getTime() >= now.getTime() - 5, 'ISO-8601 string parseable and recent');
  const patched = prepare({name: 'A', foo: 'bar'}, true);
  t.equal(patched._createdAt, undefined, 'isPatch leaves field alone');
  const roundtripped = prepare({name: 'A', _createdAt: '2024-01-01T00:00:00.000Z'}, false);
  t.equal(roundtripped._createdAt, '2024-01-01T00:00:00.000Z', 'existing value preserved');
});

test('stampCreatedAtEpoch: stamps with Date.now(); honors custom field name', async t => {
  const {stampCreatedAtEpoch} = await import('dynamodb-toolkit');
  const prepare = stampCreatedAtEpoch('createdAtMs');
  const before = Date.now();
  const stamped = prepare({name: 'A'}, false);
  const after = Date.now();
  t.ok(typeof stamped.createdAtMs === 'number', 'epoch ms is a number');
  t.ok(stamped.createdAtMs >= before && stamped.createdAtMs <= after, 'timestamp in range');
  t.equal(stamped._createdAt, undefined, 'default field name not used');
});

// --- Phase 5: typeField auto-populate (F10 core) ---

test('typeField: built-in prepare stamps typeOf on full writes', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'facility', 'vehicle'],
    structuralKey: '_sk',
    typeLabels: ['state', 'facility', 'vehicle'],
    typeField: 'kind'
  });
  const stateItem = adapter._builtInPrepare({state: 'TX'}, false);
  t.equal(stateItem.kind, 'state');
  const facilityItem = adapter._builtInPrepare({state: 'TX', facility: 'Dallas'}, false);
  t.equal(facilityItem.kind, 'facility');
  const leafItem = adapter._builtInPrepare({state: 'TX', facility: 'Dallas', vehicle: 'VIN-1'}, false);
  t.equal(leafItem.kind, 'vehicle');
});

test('typeField: user-written value wins over auto-populate', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'facility', 'vehicle'],
    structuralKey: '_sk',
    typeLabels: ['state', 'facility', 'vehicle'],
    typeField: 'kind',
    typeDiscriminator: 'kind'
  });
  // Leaf with explicit `kind: 'car'` (discriminator override) → preserved.
  const car = adapter._builtInPrepare({state: 'TX', facility: 'Dallas', vehicle: 'VIN-1', kind: 'car'}, false);
  t.equal(car.kind, 'car');
  // typeOf now reads the discriminator, returns the user's value.
  t.equal(adapter.typeOf(car), 'car');
});

test('typeField: patches skip auto-populate', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state'],
    typeLabels: ['state'],
    typeField: 'kind'
  });
  const patched = adapter._builtInPrepare({state: 'TX', foo: 'bar'}, true);
  t.equal(patched.kind, undefined, 'patch leaves kind unset');
});

test('typeField: rejects non-string', t => {
  const client = makeMockClient(async () => ({}));
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], typeField: ''}), 'empty string');
  t.throws(() => new Adapter({client, table: 'T', keyFields: ['name'], typeField: 42}), 'number');
});
