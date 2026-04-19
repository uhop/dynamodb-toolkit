import test from 'tape-six';
import {mock} from 'node:test';
import {Adapter, raw, Raw, TransactionLimitExceededError} from 'dynamodb-toolkit';

const TABLE = 'TestTable';

const makeMockClient = handler => ({send: mock.fn(handler)});

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

test('Adapter: defaults applied', t => {
  const {adapter} = makeAdapter(async () => ({}));
  t.deepEqual(adapter.projectionFieldMap, {});
  t.deepEqual(adapter.searchable, {});
  t.equal(adapter.searchablePrefix, '-search-');
  t.deepEqual(adapter.indirectIndices, {});
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
