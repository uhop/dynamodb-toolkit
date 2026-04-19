// Internal: BatchGetItem with UnprocessedKeys retry + exponential backoff.
// Retries are capped — persistent throttling throws instead of hanging forever.

import {BatchGetCommand} from '@aws-sdk/lib-dynamodb';
import {backoff} from './backoff.js';
import {sleep} from '../sleep.js';

const MAX_ATTEMPTS = 10;

export const batchGet = async (client, requestItems) => {
  let params = {RequestItems: requestItems};
  const responses = {};
  let attempts = 0;
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
      if (!data.UnprocessedKeys || !Object.keys(data.UnprocessedKeys).length) return responses;
      params = {RequestItems: data.UnprocessedKeys};
    } catch (error) {
      if (error.name !== 'ProvisionedThroughputExceededException') throw error;
    }
    if (++attempts >= MAX_ATTEMPTS) {
      throw new Error(`batchGet exceeded ${MAX_ATTEMPTS} attempts (UnprocessedKeys or throttling persisted)`);
    }
    await sleep(delay);
  }
  return responses;
};
