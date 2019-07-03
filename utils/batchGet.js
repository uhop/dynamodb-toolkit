'use strict';

const backoff = require('./backoff');
const sleep = require('./sleep');

const batchGet = async (client, params) => {
  const responses = {};
  for (const delay of backoff()) {
    try {
      const data = await client.batchGetItem(params).promise();
      Object.keys(data.Responses).forEach(tableName => {
        if (responses[tableName]) {
          responses[tableName] = responses[tableName].concat(data.Responses[tableName]);
        } else {
          responses[tableName] = data.Responses[tableName];
        }
      });
      if (!Object.keys(data.UnprocessedKeys).length) break;
      params = {RequestItems: data.UnprocessedKeys};
    } catch (error) {
      if (error.code !== 'ProvisionedThroughputExceededException') {
        throw error;
      }
    }
    await sleep(delay);
  }
  return responses;
};

module.exports = batchGet;
