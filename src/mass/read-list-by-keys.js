// Read items by a list of keys using BatchGetItem.

import {getBatch} from '../batch/get-batch.js';

export const readListByKeys = async (client, tableName, keys, params) => {
  const result = await getBatch(
    client,
    keys.map(key => ({action: 'get', params: {...params, TableName: tableName, Key: key}}))
  );
  return result.map(pair => pair.item);
};
