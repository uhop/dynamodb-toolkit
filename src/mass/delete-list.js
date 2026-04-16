// Delete items matching a query/scan, extracting keys with keyFn.

import {applyBatch} from '../batch/apply-batch.js';
import {readList} from './read-list.js';

const identity = x => x;

export const deleteList = async (client, params, keyFn = identity) => {
  let p = params,
    processed = 0;
  while (p) {
    p = await readList(client, p, async data => {
      if (data.Items?.length) {
        const keys = data.Items.map(keyFn).filter(identity);
        processed += await applyBatch(
          client,
          keys.map(key => ({action: 'delete', params: {TableName: params.TableName, Key: key}}))
        );
      }
    });
  }
  return processed;
};

export const deleteListByKeys = async (client, tableName, keys) =>
  applyBatch(
    client,
    keys.map(key => ({action: 'delete', params: {TableName: tableName, Key: key}}))
  );
