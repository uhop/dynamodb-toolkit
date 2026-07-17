// @ts-self-types="./apply-batch.d.ts"
// Chunk and execute BatchWriteItem requests with retry.

import {batchWrite} from './batch-write.js';

const BATCH_WRITE_LIMIT = 25;

const consume = (entry, items, options) => {
  if (!entry) return options;
  if (entry.action) {
    items.push(entry);
    return options;
  }
  if (entry.options) return {...options, ...entry.options};
  return options;
};

const flatten = requests => {
  const items = [];
  let options = null;
  for (const r of requests) {
    if (!r) continue;
    if (Array.isArray(r)) {
      for (const entry of r) options = consume(entry, items, options);
    } else {
      options = consume(r, items, options);
    }
  }
  return {items, options};
};

const toBatchRequest = item => {
  switch (item.action) {
    case 'put':
      return {table: item.params.TableName, request: {PutRequest: {Item: item.params.Item}}};
    case 'delete':
      return {table: item.params.TableName, request: {DeleteRequest: {Key: item.params.Key}}};
    default:
      throw new Error(`applyBatch: unknown action "${item.action}" (expected put | delete)`);
  }
};

export const applyBatch = async (client, ...requests) => {
  const {items, options} = flatten(requests);
  const retry = options?.retry;
  let total = 0;

  for (let i = 0; i < items.length; i += BATCH_WRITE_LIMIT) {
    const chunk = items.slice(i, i + BATCH_WRITE_LIMIT);
    const batch = {};
    let added = 0;
    for (const item of chunk) {
      const req = toBatchRequest(item);
      if (!batch[req.table]) batch[req.table] = [];
      batch[req.table].push(req.request);
      ++added;
    }
    if (added) {
      await batchWrite(client, batch, retry);
      total += added;
    }
  }
  return total;
};
