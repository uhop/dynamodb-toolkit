// Internal: BatchGetItem with UnprocessedKeys retry + exponential backoff.

import {BatchGetCommand} from '@aws-sdk/lib-dynamodb';
import {backoff} from './backoff.js';
import {sleep} from '../sleep.js';

export const batchGet = async (client, requestItems) => {
  let params = {RequestItems: requestItems};
  const responses = {};
  for (const delay of backoff()) {
    try {
      const data = await client.send(new BatchGetCommand(params));
      if (data.Responses) {
        for (const tableName of Object.keys(data.Responses)) {
          if (responses[tableName]) {
            responses[tableName] = responses[tableName].concat(data.Responses[tableName]);
          } else {
            responses[tableName] = data.Responses[tableName];
          }
        }
      }
      if (!data.UnprocessedKeys || !Object.keys(data.UnprocessedKeys).length) break;
      params = {RequestItems: data.UnprocessedKeys};
    } catch (error) {
      if (error.name !== 'ProvisionedThroughputExceededException') throw error;
    }
    await sleep(delay);
  }
  return responses;
};
