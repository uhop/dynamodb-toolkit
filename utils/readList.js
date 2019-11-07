'use strict';

const readListByKeys = require('./readListByKeys');

// iteratively copy a list of items by keys

const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');

const readList = async (client, params, fn) => {
  // prepare parameters
  const action = params.KeyConditionExpression ? 'query' : 'scan';
  params = cleanParams(cloneParams(params));
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
  const data = await client[action](params).promise();
  if (data.LastEvaluatedKey) {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
  return {nextParams: data.LastEvaluatedKey ? params : null, items: data.Items || []};
};

readList.byKeys = readListByKeys;

module.exports = readList;
