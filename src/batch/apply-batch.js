// Chunk and execute BatchWriteItem requests with retry.

import {batchWrite} from './batch-write.js';

const BATCH_WRITE_LIMIT = 25;

const flatten = requests => {
  const items = [];
  for (const r of requests) {
    if (!r) continue;
    if (Array.isArray(r)) {
      for (const item of r) item && items.push(item);
    } else {
      items.push(r);
    }
  }
  return items;
};

const toBatchRequest = item => {
  switch (item.action) {
    case 'put':
      return {table: item.params.TableName, request: {PutRequest: {Item: item.params.Item}}};
    case 'delete':
      return {table: item.params.TableName, request: {DeleteRequest: {Key: item.params.Key}}};
    default:
      return null;
  }
};

export const applyBatch = async (client, ...requests) => {
  const items = flatten(requests);
  let total = 0;

  for (let i = 0; i < items.length; i += BATCH_WRITE_LIMIT) {
    const chunk = items.slice(i, i + BATCH_WRITE_LIMIT);
    const batch = {};
    for (const item of chunk) {
      const req = toBatchRequest(item);
      if (!req) continue;
      if (!batch[req.table]) batch[req.table] = [];
      batch[req.table].push(req.request);
    }
    if (Object.keys(batch).length) {
      await batchWrite(client, batch);
      total += chunk.length;
    }
  }
  return total;
};
