// Read items by a list of keys via BatchGetItem and return them in the caller's
// input-key order, length-preserving (undefined at positions whose key had no
// matching item). This is a bulk-individual-read helper — the plural form of
// getByKey, not a list operation. The caller defines the set and the order;
// this helper just fetches each one in one round trip via BatchGet and
// realigns the results to caller intent.

import {getBatch} from '../batch/get-batch.js';

// Null-prototype dict: `dict['__proto__']` assigns to an own property instead
// of writing to Object.prototype. Defends against records whose key values
// happen to match reserved property names.

export const readByKeys = async (client, tableName, keys, params) => {
  const result = await getBatch(
    client,
    keys.map(key => ({action: 'get', params: {...params, TableName: tableName, Key: key}}))
  );
  const items = result.map(pair => pair.item);
  if (!keys.length) return items;

  const keyNames = Object.keys(keys[0]);
  const partitionKey = keyNames[0];
  const sortKey = keyNames[1];
  const dict = Object.create(null);

  if (sortKey) {
    for (const item of items) {
      const pk = '' + item[partitionKey];
      const sk = '' + item[sortKey];
      if (!dict[pk]) dict[pk] = Object.create(null);
      dict[pk][sk] = item;
    }
    return keys.map(key => dict[key[partitionKey]]?.[key[sortKey]] ?? undefined);
  }

  for (const item of items) {
    dict['' + item[partitionKey]] = item;
  }
  return keys.map(key => dict['' + key[partitionKey]] ?? undefined);
};
