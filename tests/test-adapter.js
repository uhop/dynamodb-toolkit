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
    const r5 = await adapter.cloneAllByParams({TableName: 'TestTable'});
    t.equal(r5.processed, 0);
    const r6 = await adapter.moveAllByParams({TableName: 'TestTable'});
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

// --- filterable declaration + applyFFilter ---

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

test('applyFFilter: throws BadFilterField for unlisted field', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['eq']}});
  let threw;
  try {
    adapter.applyFFilter({}, [{field: 'unknown', op: 'eq', values: ['x']}]);
  } catch (err) {
    threw = err;
  }
  t.ok(threw);
  t.equal(threw.name, 'BadFilterField');
});

test('applyFFilter: throws BadFilterOp when op not in allowlist', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['eq']}});
  let threw;
  try {
    adapter.applyFFilter({}, [{field: 'status', op: 'ne', values: ['x']}]);
  } catch (err) {
    threw = err;
  }
  t.ok(threw);
  t.equal(threw.name, 'BadFilterOp');
});

test('applyFFilter: comparison op → FilterExpression', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['eq']}});
  const p = adapter.applyFFilter({}, [{field: 'status', op: 'eq', values: ['active']}]);
  t.matchString(p.FilterExpression, /#ff0 = :ffv0/);
  t.equal(p.ExpressionAttributeNames['#ff0'], 'status');
  t.equal(p.ExpressionAttributeValues[':ffv0'], 'active');
});

test('applyFFilter: eq on partition key auto-promotes to KeyConditionExpression', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state'],
    filterable: {state: ['eq']}
  });
  const p = adapter.applyFFilter({}, [{field: 'state', op: 'eq', values: ['TX']}]);
  t.matchString(p.KeyConditionExpression, /#ff0 = :ffv0/);
  t.equal(p.FilterExpression, undefined, 'pk goes to KC, not FE');
});

test('applyFFilter: beg on structural-key sort-key auto-promotes', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['state', 'rentalName'],
    structuralKey: '-sk',
    filterable: {'-sk': ['beg']}
  });
  const p = adapter.applyFFilter({}, [{field: '-sk', op: 'beg', values: ['TX|Dallas|']}]);
  t.matchString(p.KeyConditionExpression, /begins_with\(#ff0, :ffv0\)/);
});

test('applyFFilter: btw requires exactly 2 values', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {cost: ['btw']}});
  t.throws(() => adapter.applyFFilter({}, [{field: 'cost', op: 'btw', values: ['1']}]));
  t.throws(() => adapter.applyFFilter({}, [{field: 'cost', op: 'btw', values: ['1', '2', '3']}]));
});

test('applyFFilter: btw with 2 values emits BETWEEN', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {cost: ['btw']}});
  const p = adapter.applyFFilter({}, [{field: 'cost', op: 'btw', values: ['10', '20']}]);
  t.matchString(p.FilterExpression, /#ff0 BETWEEN :ffv0 AND :ffv1/);
});

test('applyFFilter: in op emits IN with N placeholders', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {tag: ['in']}});
  const p = adapter.applyFFilter({}, [{field: 'tag', op: 'in', values: ['a', 'b', 'c']}]);
  t.matchString(p.FilterExpression, /#ff0 IN \(:ffv0, :ffv1, :ffv2\)/);
});

test('applyFFilter: ex / nx emit attribute_exists / attribute_not_exists', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {status: ['ex', 'nx']}});
  const pEx = adapter.applyFFilter({}, [{field: 'status', op: 'ex', values: []}]);
  t.matchString(pEx.FilterExpression, /attribute_exists\(#ff0\)/);
  const pNx = adapter.applyFFilter({}, [{field: 'status', op: 'nx', values: []}]);
  t.matchString(pNx.FilterExpression, /attribute_not_exists\(#ff0\)/);
});

test('applyFFilter: ct emits contains()', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({client, table: 'T', keyFields: ['name'], filterable: {tags: ['ct']}});
  const p = adapter.applyFFilter({}, [{field: 'tags', op: 'ct', values: ['vip']}]);
  t.matchString(p.FilterExpression, /contains\(#ff0, :ffv0\)/);
});

test('applyFFilter: number-type fields coerced', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: [{name: 'id', type: 'number'}],
    filterable: {id: ['eq']}
  });
  const p = adapter.applyFFilter({}, [{field: 'id', op: 'eq', values: ['42']}]);
  t.equal(p.ExpressionAttributeValues[':ffv0'], 42, 'string "42" coerced to 42');
});

test('applyFFilter: bad number coercion throws', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: [{name: 'id', type: 'number'}],
    filterable: {id: ['eq']}
  });
  t.throws(() => adapter.applyFFilter({}, [{field: 'id', op: 'eq', values: ['abc']}]));
});

test('applyFFilter: multiple clauses AND-combined', t => {
  const client = makeMockClient(async () => ({}));
  const adapter = new Adapter({
    client,
    table: 'T',
    keyFields: ['name'],
    filterable: {status: ['eq'], climate: ['ne']}
  });
  const p = adapter.applyFFilter({}, [
    {field: 'status', op: 'eq', values: ['active']},
    {field: 'climate', op: 'ne', values: ['hot']}
  ]);
  t.matchString(p.FilterExpression, /#ff0 = :ffv0 AND #ff1 <> :ffv1/);
});
