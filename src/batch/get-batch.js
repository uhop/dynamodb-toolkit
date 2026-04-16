// Chunk and execute BatchGetItem requests with retry, returning collected results.

import {batchGet} from './batch-get.js';
import {cleanParams} from '../expressions/clean-params.js';
import {cloneParams} from '../expressions/clone-params.js';

const BATCH_GET_LIMIT = 100;

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

export const getBatch = async (client, ...requests) => {
  const items = flatten(requests).filter(item => item.action === 'get');
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

    const responses = await batchGet(client, batch);
    for (const table of Object.keys(responses)) {
      for (const item of responses[table]) {
        result.push({table, item});
      }
    }
  }

  return result;
};
