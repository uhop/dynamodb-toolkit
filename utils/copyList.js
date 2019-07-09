'use strict';

// iteratively copy a list of items by keys

const batchWrite = require('./batchWrite');
const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');

const writeKeyList = async (client, tableName, items) => {
  if (!items.length) return;
  const params = {
    RequestItems: {
      [tableName]: items.map(item => ({PutRequest: {Item: item}}))
    }
  };
  return batchWrite(client, params);
};

const copyList = async (client, params, mapFn) => {
  // prepare parameters
  const action = params.KeyConditionExpression ? 'query' : 'scan';
  params = cleanParams(cloneParams(params));
  params.Limit = 25;

  // iterate over parameters copying records
  let processed = 0;
  for (;;) {
    const data = await client[action](params).promise();
    if (data.Items && data.Items.length) {
      processed += data.Items.length;
      await writeKeyList(client, params.TableName, data.Items.map(mapFn));
    }
    if (!data.LastEvaluatedKey) break;
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
  return processed;
};

module.exports = copyList;
