'use strict';

const batchGet = require('./batchGet');

const LIMIT = 100;

const doBatch = async (client, batch) => batchGet(client, {RequestItems: batch});

const getBatch = async (client, ...requests) => {
  let size = 0,
    batch = {},
    result = [];

  const addToBatch = item => {
    if (item.action !== 'get') return;
    const params = item.params;
    let table = batch[params.TableName];
    if (!table) {
      table = batch[params.TableName] = {Keys: []};
    }
    table.Keys.push(params.Key);
    !table.ConsistentRead && params.ConsistentRead && (table.ConsistentRead = true);
    if (params.ProjectionExpression) {
      if (table.ProjectionExpression) {
        if (table.ProjectionExpression !== params.ProjectionExpression)
          throw Error(
            `Items of the same table "${params.TableName}" has different ProjectionExpression: "${table.ProjectionExpression}" vs. "${params.ProjectionExpression}"`
          );
      } else {
        table.ProjectionExpression = params.ProjectionExpression;
      }
    }
    !table.ExpressionAttributeNames && params.ExpressionAttributeNames && (table.ExpressionAttributeNames = params.ExpressionAttributeNames);
    ++size;
  };

  const runBatch = async () => {
    const responses = await doBatch(client, batch);
    size = 0;
    batch = {};
    Object.keys(responses).forEach(table => responses[table].forEach(item => result.push({table, item})));
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
  return result;
};

module.exports = getBatch;
