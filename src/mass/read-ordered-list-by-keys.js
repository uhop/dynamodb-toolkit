// Read items by keys and return them in the caller's key order (SDK returns BatchGet in arbitrary order).

import {readListByKeys} from './read-list-by-keys.js';

export const readOrderedListByKeys = async (client, tableName, keys, params) => {
  const items = await readListByKeys(client, tableName, keys, params);
  if (!keys.length) return items;

  const keyNames = Object.keys(keys[0]);
  const partitionKey = keyNames[0];
  const sortKey = keyNames[1];
  const dict = {};

  if (sortKey) {
    // Composite key: build nested dict
    for (const item of items) {
      const pk = item[partitionKey];
      const sk = item[sortKey];
      if (!dict[pk]) dict[pk] = {};
      dict[pk][sk] = item;
    }
    return keys.map(key => dict[key[partitionKey]]?.[key[sortKey]] ?? undefined);
  }

  // Simple key: flat dict
  for (const item of items) {
    dict[item[partitionKey]] = item;
  }
  return keys.map(key => dict[key[partitionKey]] ?? undefined);
};
