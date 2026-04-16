// Execute a TransactWriteItems request. No chunking — transactions are atomic.

import {TransactWriteCommand} from '@aws-sdk/lib-dynamodb';

export const TRANSACTION_LIMIT = 100;

const toBatchItem = item => {
  switch (item.action) {
    case 'check':
      return {ConditionCheck: item.params};
    case 'delete':
      return {Delete: item.params};
    case 'put':
      return {Put: item.params};
    case 'patch':
      return {Update: item.params};
    default:
      return null;
  }
};

const flatten = requests => {
  const items = [];
  for (const r of requests) {
    if (!r) continue;
    if (Array.isArray(r)) {
      for (const item of r) {
        const mapped = toBatchItem(item);
        if (mapped) items.push(mapped);
      }
    } else {
      const mapped = toBatchItem(r);
      if (mapped) items.push(mapped);
    }
  }
  return items;
};

export const applyTransaction = async (client, ...requests) => {
  const items = flatten(requests);
  if (!items.length) return 0;
  if (items.length > TRANSACTION_LIMIT) {
    throw new Error(`Transaction exceeds the ${TRANSACTION_LIMIT}-action limit: ${items.length} actions`);
  }
  await client.send(new TransactWriteCommand({TransactItems: items}));
  return items.length;
};
