import test from 'tape-six';
import {applyBatch, applyTransaction, explainTransactionCancellation, getBatch, getTransaction, backoff, TRANSACTION_LIMIT} from 'dynamodb-toolkit/batch';
import {makeMockClient} from './helpers/mock-client.js';

// backoff

test('backoff: yields increasing values', t => {
  const gen = backoff(10, 100, true);
  const values = [...gen];
  t.ok(values.length > 0, 'produces values');
  t.ok(values.length <= 6, 'finite mode terminates');
});

test('backoff: values are bounded by the from/to range', t => {
  const gen = backoff(50, 200, true);
  for (const val of gen) {
    t.ok(val >= 0 && val < 200, `value ${val} in range`);
  }
});

// applyBatch

test('applyBatch: puts and deletes items', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    return {UnprocessedItems: {}};
  });

  const total = await applyBatch(client, [
    {action: 'put', params: {TableName: 'T', Item: {id: '1'}}},
    {action: 'delete', params: {TableName: 'T', Key: {id: '2'}}}
  ]);

  t.equal(total, 2, 'processes 2 items');
  t.equal(client.send.mock.callCount(), 1, 'one batch call');
});

test('applyBatch: chunks at 25 items', async t => {
  const client = makeMockClient(async () => ({UnprocessedItems: {}}));

  const items = Array.from({length: 30}, (_, i) => ({
    action: 'put',
    params: {TableName: 'T', Item: {id: String(i)}}
  }));

  const total = await applyBatch(client, items);
  t.equal(total, 30, 'all items processed');
  t.equal(client.send.mock.callCount(), 2, 'chunked into 2 calls');
});

test('applyBatch: retries UnprocessedItems', async t => {
  let callCount = 0;
  const client = makeMockClient(async () => {
    callCount++;
    if (callCount === 1) {
      return {UnprocessedItems: {T: [{PutRequest: {Item: {id: 'retry'}}}]}};
    }
    return {UnprocessedItems: {}};
  });

  await applyBatch(client, [{action: 'put', params: {TableName: 'T', Item: {id: '1'}}}]);
  t.ok(callCount >= 2, 'retried at least once');
});

test('applyBatch: skips null requests', async t => {
  const client = makeMockClient(async () => ({UnprocessedItems: {}}));
  const total = await applyBatch(client, null, [{action: 'put', params: {TableName: 'T', Item: {id: '1'}}}], null);
  t.equal(total, 1);
});

test('applyBatch: throws on unknown action', async t => {
  const client = makeMockClient(async () => ({UnprocessedItems: {}}));
  try {
    await applyBatch(client, [{action: 'patch', params: {TableName: 'T', Key: {id: '1'}}}]);
    t.fail('should have thrown');
  } catch (e) {
    t.matchString(e.message, /unknown action "patch"/);
  }
});

test('applyTransaction: throws on unknown action', async t => {
  const client = makeMockClient(async () => ({}));
  try {
    await applyTransaction(client, [{action: 'get', params: {TableName: 'T', Key: {id: '1'}}}]);
    t.fail('should have thrown');
  } catch (e) {
    t.matchString(e.message, /unknown action "get"/);
  }
});

// applyTransaction

test('applyTransaction: sends TransactWriteCommand', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    return {};
  });

  const count = await applyTransaction(client, [
    {action: 'put', params: {TableName: 'T', Item: {id: '1'}}},
    {action: 'delete', params: {TableName: 'T', Key: {id: '2'}}},
    {action: 'patch', params: {TableName: 'T', Key: {id: '3'}, UpdateExpression: 'SET #a = :v'}},
    {action: 'check', params: {TableName: 'T', Key: {id: '4'}, ConditionExpression: 'attribute_exists(#a)'}}
  ]);

  t.equal(count, 4, 'all 4 actions');
  t.equal(client.send.mock.callCount(), 1, 'single TransactWrite call');
});

test('applyTransaction: empty returns 0', async t => {
  const client = makeMockClient(async () => ({}));
  const count = await applyTransaction(client);
  t.equal(count, 0);
  t.equal(client.send.mock.callCount(), 0, 'no call made');
});

test('applyTransaction: throws on limit exceeded', async t => {
  const client = makeMockClient(async () => ({}));
  const items = Array.from({length: TRANSACTION_LIMIT + 1}, (_, i) => ({
    action: 'put',
    params: {TableName: 'T', Item: {id: String(i)}}
  }));

  try {
    await applyTransaction(client, items);
    t.fail('should have thrown');
  } catch (e) {
    t.matchString(e.message, /exceeds the 100-action limit/);
  }
});

test('applyTransaction: {options} sentinel plumbs ClientRequestToken + capacity knobs', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    return {};
  });

  await applyTransaction(
    client,
    {action: 'put', params: {TableName: 'T', Item: {id: '1'}}},
    {options: {clientRequestToken: 'token-abc', returnConsumedCapacity: 'TOTAL', returnItemCollectionMetrics: 'SIZE'}}
  );

  t.equal(sent[0].input.ClientRequestToken, 'token-abc');
  t.equal(sent[0].input.ReturnConsumedCapacity, 'TOTAL');
  t.equal(sent[0].input.ReturnItemCollectionMetrics, 'SIZE');
});

test('applyTransaction: {options} can appear anywhere in the arg list', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    return {};
  });

  await applyTransaction(client, {options: {clientRequestToken: 'early'}}, {action: 'put', params: {TableName: 'T', Item: {id: '1'}}});
  t.equal(sent[0].input.ClientRequestToken, 'early', 'options-first is honored');
});

test('applyTransaction: later {options} fields override earlier', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    return {};
  });

  await applyTransaction(
    client,
    {options: {clientRequestToken: 'first', returnConsumedCapacity: 'TOTAL'}},
    {action: 'put', params: {TableName: 'T', Item: {id: '1'}}},
    {options: {clientRequestToken: 'second'}}
  );
  t.equal(sent[0].input.ClientRequestToken, 'second', 'later token wins');
  t.equal(sent[0].input.ReturnConsumedCapacity, 'TOTAL', 'earlier field preserved');
});

test('applyTransaction: no options sentinel → no transaction-level fields set', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    return {};
  });

  await applyTransaction(client, {action: 'put', params: {TableName: 'T', Item: {id: '1'}}});
  t.equal(sent[0].input.ClientRequestToken, undefined);
  t.equal(sent[0].input.ReturnConsumedCapacity, undefined);
  t.equal(sent[0].input.ReturnItemCollectionMetrics, undefined);
});

test('applyTransaction: {options} only (no descriptors) is a no-op', async t => {
  const client = makeMockClient(async () => ({}));
  const count = await applyTransaction(client, {options: {clientRequestToken: 'unused'}});
  t.equal(count, 0);
  t.equal(client.send.mock.callCount(), 0, 'no SDK call');
});

// explainTransactionCancellation

const makeCanceledError = reasons => {
  const err = new Error('Transaction canceled');
  err.name = 'TransactionCanceledException';
  err.CancellationReasons = reasons;
  return err;
};

test('explainTransactionCancellation: returns null for non-cancellation errors', t => {
  t.equal(explainTransactionCancellation(null), null);
  t.equal(explainTransactionCancellation(undefined), null);
  t.equal(explainTransactionCancellation(new Error('boom')), null);
  t.equal(explainTransactionCancellation({name: 'ValidationException'}), null);
});

test('explainTransactionCancellation: pairs reasons to descriptors by index', t => {
  const descriptors = [
    {action: 'check', params: {TableName: 'planets', Key: {name: 'anchor'}}},
    {action: 'put', params: {TableName: 'planets', Item: {name: 'Hoth'}}},
    {action: 'delete', params: {TableName: 'planets', Key: {name: 'old'}}}
  ];
  const err = makeCanceledError([
    {Code: 'None'},
    {Code: 'ConditionalCheckFailed', Message: 'conflict', Item: {name: 'Hoth', climate: 'frozen'}},
    {Code: 'None'}
  ]);

  const report = explainTransactionCancellation(err, descriptors);

  t.equal(report.failures.length, 1, 'only the real failure reported');
  const f = report.failures[0];
  t.equal(f.index, 1);
  t.equal(f.code, 'ConditionalCheckFailed');
  t.equal(f.message, 'conflict');
  t.equal(f.descriptor.action, 'put');
  t.equal(f.descriptor.params.TableName, 'planets');
  t.deepEqual(f.item, {name: 'Hoth', climate: 'frozen'});
  t.matchString(report.message, /action 1 \(put to planets\): ConditionalCheckFailed — conflict/);
});

test('explainTransactionCancellation: skips {options} sentinels when pairing', t => {
  const err = makeCanceledError([{Code: 'ConditionalCheckFailed'}, {Code: 'None'}]);

  const report = explainTransactionCancellation(
    err,
    {options: {clientRequestToken: 'tok'}},
    {action: 'put', params: {TableName: 'T', Item: {id: '1'}}},
    {options: {returnConsumedCapacity: 'TOTAL'}},
    {action: 'delete', params: {TableName: 'T', Key: {id: '2'}}}
  );

  t.equal(report.failures.length, 1);
  t.equal(report.failures[0].descriptor.action, 'put', 'paired with the put, not the options sentinel');
});

test('explainTransactionCancellation: flattens arrays of descriptors', t => {
  const err = makeCanceledError([{Code: 'None'}, {Code: 'None'}, {Code: 'TransactionConflict'}]);

  const report = explainTransactionCancellation(
    err,
    [
      {action: 'put', params: {TableName: 'T', Item: {id: '1'}}},
      {action: 'put', params: {TableName: 'T', Item: {id: '2'}}}
    ],
    {action: 'check', params: {TableName: 'T', Key: {id: '3'}}}
  );

  t.equal(report.failures.length, 1);
  t.equal(report.failures[0].index, 2);
  t.equal(report.failures[0].descriptor.action, 'check');
});

test('explainTransactionCancellation: handles multiple concurrent failures', t => {
  const err = makeCanceledError([{Code: 'ConditionalCheckFailed'}, {Code: 'TransactionConflict', Message: 'concurrent update'}]);

  const report = explainTransactionCancellation(err, [
    {action: 'put', params: {TableName: 'A', Item: {id: '1'}}},
    {action: 'patch', params: {TableName: 'B', Key: {id: '2'}}}
  ]);

  t.equal(report.failures.length, 2);
  t.equal(report.failures[0].code, 'ConditionalCheckFailed');
  t.equal(report.failures[1].code, 'TransactionConflict');
  t.matchString(report.message, /action 0 \(put to A\): ConditionalCheckFailed/);
  t.matchString(report.message, /action 1 \(patch to B\): TransactionConflict — concurrent update/);
});

test('explainTransactionCancellation: empty CancellationReasons produces a no-detail summary', t => {
  const err = makeCanceledError(undefined);
  const report = explainTransactionCancellation(err, {action: 'put', params: {TableName: 'T', Item: {id: '1'}}});
  t.equal(report.failures.length, 0);
  t.matchString(report.message, /no failure details/);
});

// getBatch

test('getBatch: returns items keyed by table', async t => {
  const client = makeMockClient(async () => ({
    Responses: {
      T: [
        {id: '1', name: 'A'},
        {id: '2', name: 'B'}
      ]
    },
    UnprocessedKeys: {}
  }));

  const result = await getBatch(client, [
    {action: 'get', params: {TableName: 'T', Key: {id: '1'}}},
    {action: 'get', params: {TableName: 'T', Key: {id: '2'}}}
  ]);

  t.equal(result.length, 2);
  t.equal(result[0].table, 'T');
  t.equal(result[0].item.name, 'A');
});

test('getBatch: retries UnprocessedKeys', async t => {
  let callCount = 0;
  const client = makeMockClient(async () => {
    callCount++;
    if (callCount === 1) {
      return {
        Responses: {T: [{id: '1', name: 'A'}]},
        UnprocessedKeys: {T: {Keys: [{id: '2'}]}}
      };
    }
    return {
      Responses: {T: [{id: '2', name: 'B'}]},
      UnprocessedKeys: {}
    };
  });

  const result = await getBatch(client, [
    {action: 'get', params: {TableName: 'T', Key: {id: '1'}}},
    {action: 'get', params: {TableName: 'T', Key: {id: '2'}}}
  ]);

  t.ok(callCount >= 2, 'retried');
  t.equal(result.length, 2, 'got both items');
});

// getTransaction

test('getTransaction: returns items with adapters', async t => {
  const adapter1 = {name: 'adapter1'};
  const client = makeMockClient(async () => ({
    Responses: [{Item: {id: '1', name: 'A'}}, {Item: {id: '2', name: 'B'}}]
  }));

  const result = await getTransaction(client, [
    {action: 'get', params: {TableName: 'T', Key: {id: '1'}}, adapter: adapter1},
    {action: 'get', params: {TableName: 'T', Key: {id: '2'}}, adapter: adapter1}
  ]);

  t.equal(result.length, 2);
  t.equal(result[0].item.name, 'A');
  t.equal(result[0].adapter, adapter1);
});

test('getTransaction: empty returns empty array', async t => {
  const client = makeMockClient(async () => ({}));
  const result = await getTransaction(client);
  t.deepEqual(result, []);
  t.equal(client.send.mock.callCount(), 0);
});
