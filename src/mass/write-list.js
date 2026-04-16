// Write a list of items using BatchWriteItem, with optional map function.

import {applyBatch} from '../batch/apply-batch.js';

const identity = x => x;

export const writeList = async (client, tableName, items, mapFn = identity) =>
  applyBatch(
    client,
    items
      .map(mapFn)
      .filter(item => item)
      .map(item => ({action: 'put', params: {TableName: tableName, Item: item}}))
  );
