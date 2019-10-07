'use strict';

const batchWrite = require('./batchWrite');

const LIMIT = 25;

const doBatch = async (client, batch) => batchWrite(client, {RequestItems: batch});

const applyBatch = async (client, ...requests) => {
  let size = 0,
    total = 0,
    batch = null;

    const addToBatch = queue => {
      if (batch) {
        const old = batch[request.table];
        batch[request.table] = old ? old.concat(queue) : queue;
      } else {
        batch = {[request.table]: queue};
      }
    };

  const runBatch = async queue => {
    queue && queue.length && addToBatch(queue);
    await doBatch(client, batch);
    total += size;
    size = 0;
    batch = null;
  };

  for (const request of requests) {
    if (!request) continue;
    let queue = [];
    switch (request.action) {
      case 'put':
        for (const item of request.items) {
          queue.push({PutRequest: {Item: item}});
          if (++size >= LIMIT) {
            await runBatch(queue);
            queue = [];
          }
        }
        break;
      case 'delete':
        for (const key of request.keys) {
          queue.push({DeleteRequest: {Key: key}});
          if (++size >= LIMIT) {
            await runBatch(queue);
            queue = [];
          }
        }
        break;
    }
    queue.length && addToBatch(queue);
  }
  if (size) {
    await doBatch(client, batch);
    total += size;
  }
  return total;
};

module.exports = applyBatch;
