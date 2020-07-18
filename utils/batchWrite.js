'use strict';

const backoff = require('./backoff');
const sleep = require('./sleep');

const batchWrite = async (client, params) => {
  const action = typeof client.createSet == 'function' ? 'batchWrite' : 'batchWriteItem';
  for (const delay of backoff()) {
    try {
      const data = await client[action](params).promise();
      if (!Object.keys(data.UnprocessedItems).length) break;
      params = {RequestItems: data.UnprocessedItems};
    } catch (error) {
      if (error.code !== 'ProvisionedThroughputExceededException') {
        throw error;
      }
    }
    await sleep(delay);
  }
};

module.exports = batchWrite;
