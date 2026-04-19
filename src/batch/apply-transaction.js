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
      throw new Error(`applyTransaction: unknown action "${item.action}" (expected check | delete | put | patch)`);
  }
};

const consume = (entry, items, options) => {
  if (!entry) return options;
  if (entry.action) {
    items.push(toBatchItem(entry));
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

export const applyTransaction = async (client, ...requests) => {
  const {items, options} = flatten(requests);
  if (!items.length) return 0;
  if (items.length > TRANSACTION_LIMIT) {
    throw new Error(`Transaction exceeds the ${TRANSACTION_LIMIT}-action limit: ${items.length} actions`);
  }
  const input = {TransactItems: items};
  if (options?.clientRequestToken) input.ClientRequestToken = options.clientRequestToken;
  if (options?.returnConsumedCapacity) input.ReturnConsumedCapacity = options.returnConsumedCapacity;
  if (options?.returnItemCollectionMetrics) input.ReturnItemCollectionMetrics = options.returnItemCollectionMetrics;
  await client.send(new TransactWriteCommand(input));
  return items.length;
};
