'use strict';

// iteratively copy a list of items by keys

const applyBatch = require('./applyBatch');

const writeList = async (client, tableName, items, mapFn) => {
  return applyBatch(
    client,
    items
      .map(mapFn)
      .filter(item => item)
      .map(item => ({action: 'put', params: {TableName: tableName, Item: item}}))
  );
};

module.exports = writeList;
