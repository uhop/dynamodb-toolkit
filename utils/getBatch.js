'use strict';

const batchGet = require('./batchGet');

const LIMIT = 100;

const doBatch = async (client, batch) => batchGet(client, {RequestItems: batch});

const getBatch = async (client, ...requests) => {
  let size = 0,
    batch = null,
    result = [];

    const addToBatch = (queue, params) => {
      if (batch) {
        const old = batch[request.table];
        if (old) {
          old.Keys = old.Keys ? old.Keys.concat(queue) : queue;
        } else {
          batch[request.table] = {Keys: queue};
        }
      } else {
        batch = {[request.table]: {Keys: queue}};
      }
      if (params) {
        const table = batch[request.table];
        !table.ConsistentRead && params.ConsistentRead && (table.ConsistentRead = true);
        !table.ProjectionExpression && params.ProjectionExpression && (table.ProjectionExpression = params.ProjectionExpression);
        !table.ExpressionAttributeNames && params.ExpressionAttributeNames && (table.ExpressionAttributeNames = params.ExpressionAttributeNames);
      }
    };

  const runBatch = async (queue, params) => {
    queue && queue.length && addToBatch(queue, params);
    const responses = await doBatch(client, batch);
    size = 0;
    batch = null;
    Object.keys(responses).forEach(table => responses[table].forEach(item => result.push({table, item})));
  };

  for (const request of requests) {
    if (!request) continue;
    let queue = [];
    switch (request.action) {
      case 'get':
        for (const key of request.keys) {
          queue.push(key);
          if (++size >= LIMIT) {
            await runBatch(queue, request.params);
            queue = [];
          }
        }
        break;
    }
    queue.length && addToBatch(queue, request.params);
  }
  if (size) {
    await runBatch();
  }
  return result;
};

module.exports = getBatch;
