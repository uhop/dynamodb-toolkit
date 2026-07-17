// @ts-self-types="./get-batch.d.ts"
// Chunk and execute BatchGetItem requests with retry, returning collected results.

import {batchGet} from './batch-get.js';
import {cleanParams} from '../expressions/clean-params.js';
import {cloneParams} from '../expressions/clone-params.js';

const BATCH_GET_LIMIT = 100;

const consume = (entry, items, options) => {
  if (!entry) return options;
  if (entry.action === 'get') {
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

export const getBatch = async (client, ...requests) => {
  const {items, options} = flatten(requests);
  const retry = options?.retry;
  const result = [];

  for (let i = 0; i < items.length; i += BATCH_GET_LIMIT) {
    const chunk = items.slice(i, i + BATCH_GET_LIMIT);
    const batch = {};

    for (const item of chunk) {
      const params = item.params;
      let table = batch[params.TableName];
      if (!table) {
        table = batch[params.TableName] = {Keys: []};
      }
      table.Keys.push(params.Key);
      if (!table.ConsistentRead && params.ConsistentRead) table.ConsistentRead = true;
      if (params.ProjectionExpression) {
        if (table.ProjectionExpression) {
          if (table.ProjectionExpression !== params.ProjectionExpression) {
            throw new Error(
              `Items of the same table "${params.TableName}" have different ProjectionExpression: "${table.ProjectionExpression}" vs. "${params.ProjectionExpression}"`
            );
          }
        } else {
          table.ProjectionExpression = params.ProjectionExpression;
        }
      }
      if (!table.ExpressionAttributeNames && params.ExpressionAttributeNames) {
        table.ExpressionAttributeNames = params.ExpressionAttributeNames;
      }
    }

    // Clean attribute maps before sending
    for (const tableName of Object.keys(batch)) {
      batch[tableName] = cleanParams(cloneParams(batch[tableName]));
    }

    const responses = await batchGet(client, batch, retry);
    for (const table of Object.keys(responses)) {
      for (const item of responses[table]) {
        result.push({table, item});
      }
    }
  }

  return result;
};
