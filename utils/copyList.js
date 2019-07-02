'use strict';

// iteratively copy a list of items by keys

const batchWrite = require('./batchWrite');

const writeKeyList = async (client, tableName, items) => {
  if (!items.length) return;
  const params = {
    RequestItems: {
      [tableName]: items.map(item => ({PutRequest: {Item: item}}))
    }
  };
  await batchWrite(client, params);
};

const copyList = async (client, action, params, mapFn) => {
  // prepare parameters
  params = Object.assign({}, params);
  params.Limit = 25;

  // iterate over parameters copying records
  for (;;) {
    const data = await client[action](params).promise();
    if (data.Items && data.Items.length) {
      await writeKeyList(client, params.TableName, data.Items.map(mapFn));
    }
    if (!data.LastEvaluatedKey) break;
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
};

module.exports = copyList;
