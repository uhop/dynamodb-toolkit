// Delete items matching a query/scan, extracting keys with keyFn.

import {applyBatch} from '../batch/apply-batch.js';
import {readList} from './read-list.js';

const identity = x => x;

export const deleteList = async (client, params, keyFn = identity, retry) => {
  let p = params,
    processed = 0;
  while (p) {
    p = await readList(client, p, async data => {
      if (data.Items?.length) {
        const keys = data.Items.map(keyFn).filter(identity);
        processed += await applyBatch(
          client,
          keys.map(key => ({action: 'delete', params: {TableName: params.TableName, Key: key}})),
          retry && {options: {retry}}
        );
      }
    });
  }
  return processed;
};

export const deleteByKeys = async (client, tableName, keys, retry) =>
  applyBatch(
    client,
    keys.map(key => ({action: 'delete', params: {TableName: tableName, Key: key}})),
    retry && {options: {retry}}
  );
