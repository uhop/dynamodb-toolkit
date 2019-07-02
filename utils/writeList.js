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

const writeList = async (client, tableName, items, mapFn) => {
  // iterate over parameters copying records
  for (let i = 0; i < items.length; i += 25) {
    // select items of 25
    await writeKeyList(client, tableName, items.slice(i, i + 25).map(mapFn));
  }
};

module.exports = writeList;
