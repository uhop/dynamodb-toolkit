'use strict';

// iteratively copy a list of items by keys

const readListByKeys = require('./readListByKeys');
const writeList = require('./writeList');

const copyListByKeys = async (client, tableName, keys, mapFn) => {
  let processed = 0;
  for (let offset = 0; offset < keys.length; offset += 25) {
    const items = await readListByKeys(client, tableName, keys.slice(offset, offset + 25));
    processed += await writeList(client, tableName, items, mapFn);
  }
  return processed;
};

module.exports = copyListByKeys;
