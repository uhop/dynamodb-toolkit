'use strict';

// iteratively copy a list of items by keys

const batchGet = require('./batchGet');
const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');

const readKeyList = async (client, tableName, keys, generalParams) => {
  if (!keys.length) return {};
  const params = {
    RequestItems: {
      [tableName]: {
        Keys: keys
      }
    }
  };
  const table = params.RequestItems[tableName];
  if (generalParams.ConsistentRead) {
    table.ConsistentRead = true;
  }
  if (generalParams.ProjectionExpression) {
    table.ProjectionExpression = generalParams.ProjectionExpression;
  }
  if (generalParams.ExpressionAttributeNames) {
    table.ExpressionAttributeNames = generalParams.ExpressionAttributeNames;
  }
  return batchGet(client, params);
};

const readList = async (client, params, fn) => {
  // prepare parameters
  const action = params.KeyConditionExpression ? 'query' : 'scan';
  params = cleanParams(cloneParams(params));
  if (!params.hasOwnProperty('Limit')) params.Limit = 100;
  const data = await client[action](params).promise();
  await fn(data);
  if (data.LastEvaluatedKey) {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
    return params;
  }
  return null;
};

readList.getItems = async (client, params) => {
  // prepare parameters
  const action = params.KeyConditionExpression ? 'query' : 'scan';
  params = cleanParams(cloneParams(params));
  if (!params.hasOwnProperty('Limit')) params.Limit = 100;
  const data = await client[action](params).promise();
  if (data.LastEvaluatedKey) {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
  return {nextParams: data.LastEvaluatedKey ? params : null, items: data.Items || []};
};

readList.byKeys = async (client, tableName, keys, generalParams) => {
  // sanitize individual per-table parameters
  let gp = {};
  if (generalParams) {
    if (generalParams.ConsistentRead) {
      gp.ConsistentRead = true;
    }
    if (generalParams.ProjectionExpression) {
      gp.ProjectionExpression = generalParams.ProjectionExpression;
    }
    if (generalParams.ExpressionAttributeNames) {
      gp.ExpressionAttributeNames = generalParams.ExpressionAttributeNames;
    }
    gp = cleanParams(gp);
  }
  // iterate over parameters copying records
  let items = [];
  for (let i = 0; i < keys.length; i += 100) {
    // select items of 100
    const responses = await readKeyList(client, tableName, keys.slice(i, i + 100), gp);
    if (responses[tableName]) {
      items = items.concat(responses[tableName]);
    }
  }
  return items;
};

module.exports = readList;
