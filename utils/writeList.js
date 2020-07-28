'use strict';

// write a list of items with a transformation/filtering applied

const applyBatch = require('./applyBatch');

const writeList = async (client, tableName, items, mapFn) =>
  applyBatch(
    client,
    items
      .map(mapFn)
      .filter(item => item)
      .map(item => ({action: 'put', params: {TableName: tableName, Item: item}}))
  );

module.exports = writeList;
