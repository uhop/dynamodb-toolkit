'use strict';

// iteratively move a list of items by keys

const readListByKeys = require('./readListByKeys');
const applyBatch = require('./applyBatch');

const moveListByKeys = async (client, tableName, keys, mapFn) => {
  let processed = 0;
  for (let offset = 0; offset < keys.length; offset += 12) {
    const itemKeys = keys.slice(offset, offset + 12),
      items = await readListByKeys(client, tableName, itemKeys);
    processed += await applyBatch(client, [
      ...items
        .map(mapFn)
        .filter(item => item)
        .map(item => ({action: 'put', params: {TableName: tableName, Item: item}})),
      ...itemKeys.map(key => ({action: 'delete', params: {TableName: tableName, Key: key}}))
    ]);
  }
  return processed;
};

module.exports = moveListByKeys;
