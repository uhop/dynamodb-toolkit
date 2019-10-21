'use strict';

const batchWrite = require('./batchWrite');

const LIMIT = 25;

const doBatch = async (client, batch) => batchWrite(client, {RequestItems: batch});

const applyBatch = async (client, ...requests) => {
  let size = 0,
    total = 0,
    batch = {};

  const addToBatch = item => {
    const params = item.params;
    let request;
    switch (item.action) {
      case 'put':
        request = {PutRequest: {Item: item.params.Item}};
        break;
      case 'delete':
        request = {DeleteRequest: {Key: item.params.Key}};
        break;
    }
    if (!request) return;
    let table = batch[params.TableName];
    if (!table) {
      table = batch[params.TableName] = [];
    }
    table.push(request);
    ++size;
  };

  const runBatch = async () => {
    await doBatch(client, batch);
    total += size;
    size = 0;
    batch = {};
  };

  for (const request of requests) {
    if (!request) continue;
    if (request instanceof Array) {
      for (const item of request) {
        addToBatch(item);
        size >= LIMIT && (await runBatch());
      }
      continue;
    }
    addToBatch(request);
    size >= LIMIT && (await runBatch());
  }
  size && (await runBatch());
  return total;
};

module.exports = applyBatch;
