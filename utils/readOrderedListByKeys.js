'use strict';

// iteratively copy a list of items by keys

'use strict';

const readListByKeys = require('./readListByKeys');

const readOrderedListByKeys = async (client, tableName, keys, params) => {
  const items = await readListByKeys(client, tableName, keys, params);
  if (!keys.length) return items;
  const [partitionKey, sortKey] = Object.keys(keys[0]);
  const dict = {};
  if (typeof sortKey == 'string') {
    // two keys:
    // build a dictionary
    items.forEach(item => {
      const partitionValue = item[partitionKey],
        sortValue = item[sortKey],
        partitionKeyValue = partitionValue instanceof Buffer ? partitionValue.toString('base64') : partitionValue,
        sortKeyValue = sortValue instanceof Buffer ? sortValue.toString('base64') : sortValue;
      if (typeof dict[partitionKeyValue] != 'object') dict[partitionKeyValue] = {};
      dict[partitionKeyValue][sortKeyValue] = item;
    });
    // build the list
    return keys.map(key => {
      const partitionValue = key[partitionKey],
        partitionKeyValue = partitionValue instanceof Buffer ? partitionValue.toString('base64') : partitionValue;
      let value = dict[partitionKeyValue];
      if (typeof value != 'object') return null;
      const sortValue = key[sortKey],
        sortKeyValue = sortValue instanceof Buffer ? sortValue.toString('base64') : sortValue;
      value = value[sortKeyValue];
      return typeof value == 'object' ? value : null;
    });
  }
  // one key:
  // build a dictionary
  items.forEach(item => {
    const partitionValue = item[partitionKey],
      partitionKeyValue = partitionValue instanceof Buffer ? partitionValue.toString('base64') : partitionValue;
    dict[partitionKeyValue] = item;
  });
  // build the list
  return keys.map(key => {
    const partitionValue = key[partitionKey],
      partitionKeyValue = partitionValue instanceof Buffer ? partitionValue.toString('base64') : partitionValue,
      value = dict[partitionKeyValue];
    return typeof value == 'object' ? value : null;
  });
};

module.exports = readOrderedListByKeys;
