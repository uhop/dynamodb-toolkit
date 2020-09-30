'use strict';

// iteratively copy a list of items by keys

'use strict';

const readListByKeys = require('./readListByKeys');

const getValue = object => {
  if (object && typeof object == 'object') {
    if (object.hasOwnProperty('S')) {
      object = object.S;
    } else if (object.hasOwnProperty('N')) {
      object = object.N;
    } else if (object.hasOwnProperty('B')) {
      object = object.B;
    }
  }
  return object instanceof Buffer ? object.toString('base64') : object;
};

const readOrderedListByKeys = async (client, tableName, keys, params) => {
  const items = await readListByKeys(client, tableName, keys, params);
  if (!keys.length) return items;
  const [partitionKey, sortKey] = Object.keys(keys[0]);
  const dict = {};
  if (typeof sortKey == 'string') {
    // two keys:
    // build a dictionary
    items.forEach(item => {
      const partitionValue = getValue(item[partitionKey]),
        sortValue = getValue(item[sortKey]);
      if (typeof dict[partitionValue] != 'object') dict[partitionValue] = {};
      dict[partitionValue][sortValue] = item;
    });
    // build the list
    return keys.map(key => {
      const partitionValue = getValue(key[partitionKey]);
      let value = dict[partitionValue];
      if (typeof value != 'object') return undefined;
      const sortValue = getValue(key[sortKey]);
      value = value[sortValue];
      return typeof value == 'object' ? value : undefined;
    });
  }
  // one key:
  // build a dictionary
  items.forEach(item => {
    const partitionValue = getValue(item[partitionKey]);
    dict[partitionValue] = item;
  });
  // build the list
  return keys.map(key => {
    const partitionValue = getValue(key[partitionKey]),
      value = dict[partitionValue];
    return typeof value == 'object' ? value : undefined;
  });
};

module.exports = readOrderedListByKeys;
