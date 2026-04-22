// Bulk-individual write helper — the caller supplies N items, the toolkit
// batches them via BatchWriteItem with an optional per-item mapFn. Not a
// list operation (the DB doesn't produce the set); plural form of `put`.

import {applyBatch} from '../batch/apply-batch.js';

const identity = x => x;

export const writeItems = async (client, tableName, items, mapFn = identity) =>
  applyBatch(
    client,
    items
      .map(mapFn)
      .filter(item => item)
      .map(item => ({action: 'put', params: {TableName: tableName, Item: item}}))
  );
