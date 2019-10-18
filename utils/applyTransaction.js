'use strict';

const combineParams = require('./combineParams');

const doBatch = async (client, batch) => client.transactWriteItems({TransactItems: batch}).promise();

const applyTransaction = async (client, ...requests) => {
  let batch = [];

  for (const request of requests) {
    if (!request) continue;
    const params = request.params,
      base = {};
    if (params) {
      params.ConditionExpression && (base.ConditionExpression = params.ConditionExpression);
      params.ExpressionAttributeNames && (base.ExpressionAttributeNames = params.ExpressionAttributeNames);
      params.ExpressionAttributeValues && (base.ExpressionAttributeValues = params.ExpressionAttributeValues);
    }
    switch (request.action) {
      case 'check':
        for (const key of request.keys) {
          batch.push({ConditionCheck: {TableName: request.table, Key: key, ...base}});
        }
        break;
      case 'delete':
        for (const key of request.keys) {
          batch.push({Delete: {TableName: request.table, Key: key, ...base}});
        }
        break;
      case 'put':
        for (const item of request.items) {
          batch.push({Put: {TableName: request.table, Item: item, ...base}});
        }
        break;
      case 'patch':
        for (const item of request.items) {
          const p = combineParams(base, item.params),
            updateItem = {TableName: request.table, Key: item.key, UpdateExpression: p.UpdateExpression};
          p.ConditionExpression && (updateItem.ConditionExpression = p.ConditionExpression);
          p.ExpressionAttributeNames && (updateItem.ExpressionAttributeNames = p.ExpressionAttributeNames);
          p.ExpressionAttributeValues && (updateItem.ExpressionAttributeValues = p.ExpressionAttributeValues);
          batch.push({Update: updateItem});
        }
        break;
    }
  }
  batch.length && await doBatch(client, batch);
  return batch.length;
};

module.exports = applyTransaction;
