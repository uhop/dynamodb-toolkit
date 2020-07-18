'use strict';

const doBatch = async (client, action, batch) => client[action]({TransactItems: batch}).promise();

const processBatchItem = batch => {
  switch (batch.action) {
    case 'get':
      return {Get: batch.params};
  }
};

const getTransaction = async (client, ...requests) => {
  const action = typeof client.createSet == 'function' ? 'transactGet' : 'transactGetItems';
  let batch = [],
    adapters = [];
  for (const request of requests) {
    if (!request) continue;
    if (request instanceof Array) {
      request.forEach(item => {
        const batchItem = processBatchItem(item);
        if (batchItem) {
          batch.push(batchItem);
          adapters.push(item.adapter);
        }
      });
      continue;
    }
    const batchItem = processBatchItem(request);
    batchItem && batch.push(batchItem);
  }
  if (!batch.length) return [];
  const result = await doBatch(client, action, batch);
  return result.responses.map((item, index) => ({table: batch[index].TableName, item: item && item.Item, adapter: adapters[index]}));
};

module.exports = getTransaction;
