'use strict';

const doBatch = async (client, action, batch) => client[action]({TransactItems: batch}).promise();

const processBatchItem = batch => {
  switch (batch.action) {
    case 'check':
      return {ConditionCheck: batch.params};
    case 'delete':
      return {Delete: batch.params};
    case 'put':
      return {Put: batch.params};
    case 'patch':
      return {Update: batch.params};
  }
};

const applyTransaction = async (client, ...requests) => {
  const action = typeof client.createSet == 'function' ? 'transactWrite' : 'transactWriteItems';
  let batch = [];
  for (const request of requests) {
    if (!request) continue;
    if (request instanceof Array) {
      request.forEach(item => {
        const batchItem = processBatchItem(item);
        batchItem && batch.push(batchItem);
      });
      continue;
    }
    const batchItem = processBatchItem(request);
    batchItem && batch.push(batchItem);
  }
  batch = batch.filter(item => item);
  batch.length && (await doBatch(client, action, batch));
  return batch.length;
};

module.exports = applyTransaction;
