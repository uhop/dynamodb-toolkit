'use strict';

// iteratively delete a list of items by keys

const batchWrite = require('./batchWrite');

const deleteKeyList = async (client, tableName, keyList) => {
  if (!keyList.length) return;
  const params = {
    RequestItems: {
      [tableName]: keyList.map(key => ({DeleteRequest: {Key: key}}))
    }
  };
  return batchWrite(client, params);
};

const deleteList = async (client, params) => {
  // prepare parameters
  const action = params.KeyConditionExpression ? 'query' : 'scan';
  params = Object.assign({}, params);
  params.Limit = 25;

  // iterate over parameters deleting records
  let processed = 0;
  for (;;) {
    const data = await client[action](params).promise();
    if (data.Items && data.Items.length) {
      processed += data.Items.length;
      await deleteKeyList(client, params.TableName, data.Items);
    }
    if (!data.LastEvaluatedKey) break;
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
  return processed;
};

module.exports = deleteList;
