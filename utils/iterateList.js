'use strict';

// iteratively copy a list of items by keys

const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');

const iterateList = async function*(client, params) {
  params = cleanParams(cloneParams(params));
  const action = params.KeyConditionExpression ? 'query' : 'scan';
  for (;;) {
    const data = await client[action](params).promise();
    yield data;
    if (!data.LastEvaluatedKey) break;
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
};

iterateList.byItem = async function*(client, params) {
  for await (const data of iterateList(client, params)) {
    if (data.Items && data.Items.length) {
      yield* data.Items;
    }
  }
};

module.exports = iterateList;
