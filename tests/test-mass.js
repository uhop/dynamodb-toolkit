import test from 'tape-six';
import {paginateList, iterateList, iterateItems, readByKeys, writeList, deleteList, deleteByKeys, copyList, moveList, getTotal} from 'dynamodb-toolkit/mass';
import {makeMockClient} from './helpers/mock-client.js';

// Helper: make a simple scan-like mock that returns all items in one page
const singlePageClient = items =>
  makeMockClient(async () => ({
    Items: items,
    Count: items.length,
    ScannedCount: items.length
  }));

// Helper: make a mock that also handles BatchWrite
const batchClient = (scanItems, batchHandler) =>
  makeMockClient(async cmd => {
    const name = cmd.constructor.name;
    if (name === 'ScanCommand' || name === 'QueryCommand') {
      return {Items: scanItems, Count: scanItems.length, ScannedCount: scanItems.length};
    }
    if (name === 'BatchWriteCommand') {
      if (batchHandler) return batchHandler(cmd);
      return {UnprocessedItems: {}};
    }
    return {};
  });

// getTotal

test('getTotal: counts across pages', async t => {
  let callCount = 0;
  const client = makeMockClient(async () => {
    callCount++;
    if (callCount === 1) return {Count: 50, LastEvaluatedKey: {id: '50'}};
    return {Count: 11};
  });
  const total = await getTotal(client, {TableName: 'T'});
  t.equal(total, 61);
  t.equal(callCount, 2);
});

// iterateList / iterateItems

test('iterateList: yields pages', async t => {
  let callCount = 0;
  const client = makeMockClient(async () => {
    callCount++;
    if (callCount === 1) return {Items: [{id: '1'}], Count: 1, LastEvaluatedKey: {id: '1'}};
    return {Items: [{id: '2'}], Count: 1};
  });
  const pages = [];
  for await (const page of iterateList(client, {TableName: 'T'})) {
    pages.push(page);
  }
  t.equal(pages.length, 2);
  t.equal(pages[0].Items[0].id, '1');
});

test('iterateItems: yields individual items', async t => {
  const client = makeMockClient(async () => ({Items: [{id: '1'}, {id: '2'}], Count: 2}));
  const items = [];
  for await (const item of iterateItems(client, {TableName: 'T'})) {
    items.push(item);
  }
  t.equal(items.length, 2);
  t.equal(items[1].id, '2');
});

// readByKeys

test('readByKeys: preserves caller key order', async t => {
  const client = makeMockClient(async () => ({
    Responses: {
      T: [
        {name: 'B', val: 2},
        {name: 'A', val: 1},
        {name: 'C', val: 3}
      ]
    },
    UnprocessedKeys: {}
  }));
  const result = await readByKeys(client, 'T', [{name: 'A'}, {name: 'B'}, {name: 'C'}]);
  t.equal(result[0].val, 1, 'A first');
  t.equal(result[1].val, 2, 'B second');
  t.equal(result[2].val, 3, 'C third');
});

test('readByKeys: missing keys return undefined', async t => {
  const client = makeMockClient(async () => ({
    Responses: {T: [{name: 'A', val: 1}]},
    UnprocessedKeys: {}
  }));
  const result = await readByKeys(client, 'T', [{name: 'A'}, {name: 'MISSING'}]);
  t.equal(result[0].val, 1);
  t.equal(result[1], undefined);
});

test('readByKeys: record with partition-key value "__proto__" does not pollute Object.prototype', async t => {
  const client = makeMockClient(async () => ({
    Responses: {
      T: [
        {pk: '__proto__', sk: 'x', polluted: 'yes'},
        {pk: 'real', sk: 'y', val: 1}
      ]
    },
    UnprocessedKeys: {}
  }));
  const result = await readByKeys(client, 'T', [
    {pk: '__proto__', sk: 'x'},
    {pk: 'real', sk: 'y'}
  ]);
  t.equal(result[0]?.polluted, 'yes', 'own lookup still works');
  t.equal(result[1]?.val, 1);
  t.equal({}.polluted, undefined, 'Object.prototype not polluted');
});

// writeList

test('writeList: writes items via batch', async t => {
  const client = makeMockClient(async () => ({UnprocessedItems: {}}));
  const count = await writeList(client, 'T', [{id: '1'}, {id: '2'}]);
  t.equal(count, 2);
});

test('writeList: applies mapFn', async t => {
  const written = [];
  const client = makeMockClient(async cmd => {
    const items = cmd.input.RequestItems.T;
    items.forEach(r => written.push(r.PutRequest.Item));
    return {UnprocessedItems: {}};
  });
  await writeList(client, 'T', [{id: '1'}], item => ({...item, extra: true}));
  t.ok(written[0].extra, 'mapFn applied');
});

// deleteByKeys

test('deleteByKeys: deletes by keys', async t => {
  const client = makeMockClient(async () => ({UnprocessedItems: {}}));
  const count = await deleteByKeys(client, 'T', [{id: '1'}, {id: '2'}]);
  t.equal(count, 2);
});

// deleteList

test('deleteList: reads then deletes', async t => {
  const client = batchClient([
    {id: '1', name: 'A'},
    {id: '2', name: 'B'}
  ]);
  const count = await deleteList(client, {TableName: 'T'}, item => ({id: item.id}));
  t.equal(count, 2);
});

// copyList

test('copyList: reads and writes with mapFn', async t => {
  const client = batchClient([{id: '1'}, {id: '2'}]);
  const count = await copyList(client, {TableName: 'T'}, item => ({...item, copied: true}));
  t.equal(count, 2);
});

// moveList

test('moveList: puts and deletes', async t => {
  const client = batchClient([{id: '1'}]);
  const count = await moveList(
    client,
    {TableName: 'T'},
    item => ({...item, moved: true}),
    item => ({id: item.id})
  );
  t.equal(count, 2, 'put + delete = 2 batch items');
});

test('moveList: mapFn returning falsy drops the delete too (paired dispatch)', async t => {
  const sent = [];
  const client = makeMockClient(async cmd => {
    sent.push(cmd);
    if (cmd.constructor.name === 'BatchWriteCommand') return {UnprocessedItems: {}};
    return {Items: [{id: '1', skip: true}, {id: '2'}], Count: 2};
  });
  const count = await moveList(
    client,
    {TableName: 'T'},
    item => (item.skip ? null : item), // drop id=1
    item => ({id: item.id})
  );
  // Only id=2 should be moved: 1 put + 1 delete = 2
  t.equal(count, 2, 'only paired put+delete count');
  const writeCmd = sent.find(c => c.constructor.name === 'BatchWriteCommand');
  const requests = writeCmd.input.RequestItems.T;
  t.equal(requests.length, 2, 'one put + one delete (not one delete for id=1 orphaned)');
  const deletedIds = requests.filter(r => r.DeleteRequest).map(r => r.DeleteRequest.Key.id);
  t.deepEqual(deletedIds, ['2'], 'id=1 NOT deleted because its mapFn returned falsy');
});

// paginateList

test('paginateList: basic pagination with total', async t => {
  const client = makeMockClient(async cmd => {
    const input = cmd.input;
    if (input.Select === 'COUNT') return {Count: 0};
    return {Items: [{id: '1'}, {id: '2'}], Count: 2};
  });
  const result = await paginateList(client, {TableName: 'T'}, {offset: 0, limit: 10});
  t.equal(result.data.length, 2);
  t.equal(result.offset, 0);
  t.equal(result.limit, 10);
  t.equal(result.total, 2);
});

test('paginateList: needTotal=false omits total', async t => {
  const client = singlePageClient([{id: '1'}]);
  const result = await paginateList(client, {TableName: 'T'}, {offset: 0, limit: 10}, false);
  t.equal(result.data.length, 1);
  t.equal(result.total, undefined);
});

test('paginateList: respects maxLimit', async t => {
  const items = Array.from({length: 20}, (_, i) => ({id: String(i)}));
  const client = singlePageClient(items);
  const result = await paginateList(client, {TableName: 'T'}, {offset: 0, limit: 200}, false, 10, 15);
  t.equal(result.limit, 15, 'clamped to maxLimit');
  t.equal(result.data.length, 15);
});

test('paginateList: negative offset returns empty data with total', async t => {
  let countCalls = 0;
  const client = makeMockClient(async () => {
    countCalls++;
    return {Count: 42};
  });
  const result = await paginateList(client, {TableName: 'T'}, {offset: -1, limit: 10});
  t.equal(result.data.length, 0);
  t.equal(result.total, 42);
});
