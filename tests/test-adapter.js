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
        validateCount++;
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
        validateCount++;
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
          prepareCount++;
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

test('putAll: native uses BatchWrite', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {UnprocessedItems: {}};
  });
  const r = await adapter.putAll([{name: 'A'}, {name: 'B'}, {name: 'C'}]);
  t.equal(r.processed, 3);
  t.equal(sent[0].constructor.name, 'BatchWriteCommand');
});

test('putAll: sequential uses individual Puts', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  const r = await adapter.putAll([{name: 'A'}, {name: 'B'}], {strategy: 'sequential'});
  t.equal(r.processed, 2);
  t.equal(sent.filter(c => c.constructor.name === 'PutCommand').length, 2);
});

test('putAll: sequential propagates options.params', async t => {
  const sent = [];
  const {adapter} = makeAdapter(async cmd => {
    sent.push(cmd);
    return {};
  });
  await adapter.putAll([{name: 'A'}], {strategy: 'sequential', params: {ReturnConsumedCapacity: 'TOTAL'}});
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

// --- getAll / getAllByParams ---

test('getAllByParams: paginates and revives', async t => {
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
  const r = await adapter.getAllByParams({}, {offset: 0, limit: 10});
  t.equal(r.data.length, 2);
  t.notOk(r.data[0]._x, 'revive stripped');
});

test('getAllByParams: needTotal:false omits total', async t => {
  const {adapter} = makeAdapter(async () => ({Items: [{name: 'A'}], Count: 1}));
  const r = await adapter.getAllByParams({}, {offset: 0, limit: 10, needTotal: false});
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

test('adapter.buildKey: composite kind=exact joins with separator', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  const p = adapter.buildKey({state: 'TX', rentalName: 'Dallas'});
  t.equal(p.KeyConditionExpression, '#kc0 = :kcv0');
  t.equal(p.ExpressionAttributeNames['#kc0'], '-sk');
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX|Dallas');
});

test('adapter.buildKey: kind=children appends trailing separator + begins_with', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName', 'carVin'],
    structuralKey: {name: '-sk'}
  });
  const p = adapter.buildKey({state: 'TX', rentalName: 'Dallas'}, {kind: 'children'});
  t.equal(p.KeyConditionExpression, 'begins_with(#kc0, :kcv0)');
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX|Dallas|');
});

test('adapter.buildKey: partial appends separator + prefix', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  const p = adapter.buildKey({state: 'TX'}, {partial: 'Dal'});
  t.equal(p.KeyConditionExpression, 'begins_with(#kc0, :kcv0)');
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX|Dal');
});

test('adapter.buildKey: kind=partial requires non-empty partial string', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: {name: '-sk'}
  });
  t.throws(() => adapter.buildKey({state: 'TX'}, {kind: 'partial'}), 'partial missing');
  t.throws(() => adapter.buildKey({state: 'TX'}, {kind: 'partial', partial: ''}), 'partial empty');
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
  const p = adapter.buildKey({state: 'TX', rentalId: 42, carVin: 'V1'});
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX|00042|V1');
});

test('adapter.buildKey: custom separator applied', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'carVin'],
    structuralKey: {name: '-sk', separator: '::'}
  });
  const p = adapter.buildKey({state: 'TX', carVin: 'V1'});
  t.equal(p.ExpressionAttributeValues[':kcv0'], 'TX::V1');
});

test('adapter.buildKey: indexName option throws until declarative GSI surface lands', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.throws(() => adapter.buildKey({name: 'x'}, {indexName: 'by-name'}), 'indexName not supported yet');
});

test('adapter.buildKey: single-field keyFields + kind=children throws', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.throws(() => adapter.buildKey({name: 'x'}, {kind: 'children'}), 'needs structuralKey');
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
