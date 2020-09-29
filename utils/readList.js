'use strict';

// iteratively copy a list of items by keys

const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');
const readListByKeys = require('./readListByKeys');

const readList = async (client, params, fn) => {
  params = cleanParams(cloneParams(params));
  const action = params.KeyConditionExpression ? 'query' : 'scan',
    data = await client[action](params).promise();
  await fn(data);
  if (data.LastEvaluatedKey) {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
    return params;
  }
  return null;
};

readList.getItems = async (client, params) => {
  params = cleanParams(cloneParams(params));
  const action = params.KeyConditionExpression ? 'query' : 'scan',
    data = await client[action](params).promise();
  if (data.LastEvaluatedKey) {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
  return {nextParams: data.LastEvaluatedKey ? params : null, items: data.Items || []};
};

readList.byKeys = readListByKeys;

module.exports = readList;
