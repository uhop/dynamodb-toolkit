'use strict';

const backoff = require('./backoff');
const sleep = require('./sleep');

const batchWrite = async (client, params) => {
  // console.log('Process', Object.keys(params.RequestItems).length, 'items.');
  for (const delay of backoff()) {
    try {
      const data = await client.batchWriteItem(params).promise();
      if (!Object.keys(data.UnprocessedItems).length) return;
      params = {RequestItems: data.UnprocessedItems};
      // console.log('Retrying', Object.keys(params.RequestItems).length, 'items.');
    } catch (error) {
      if (error.code !== 'ProvisionedThroughputExceededException') {
        console.log('ERROR in batchWrite', error);
        throw error;
      }
    }
    await sleep(delay);
  }
};

module.exports = batchWrite;
