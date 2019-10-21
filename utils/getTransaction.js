'use strict';

const doBatch = async (client, batch) => client.transactGetItems({TransactItems: batch}).promise();

const processBatchItem = batch => {
  switch (batch.action) {
    case 'get':
      return {Get: batch.params};
  }
};

const getTransaction = async (client, ...requests) => {
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
  const result = await doBatch(client, batch);
  return result.responses.map((item, index) => ({table: batch[index].TableName, item: item && item.Item, adapter: adapters[index]}));
};

module.exports = getTransaction;
