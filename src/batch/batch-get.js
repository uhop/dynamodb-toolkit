// Internal: BatchGetItem with UnprocessedKeys retry + exponential backoff.
// Retries are capped — persistent throttling throws instead of hanging forever.

import {BatchGetCommand} from '@aws-sdk/lib-dynamodb';
import {backoff} from './backoff.js';
import {sleep} from '../sleep.js';

// With default backoff (cap 20s), 8 attempts yield max ~43s total wait —
// fits AWS's "stop around one minute" guidance for DynamoDB retries.
const MAX_ATTEMPTS = 8;

export const batchGet = async (client, requestItems, retry) => {
  const maxAttempts = retry?.maxAttempts ?? MAX_ATTEMPTS;
  let params = {RequestItems: requestItems};
  const responses = {};
  let attempts = 0;
  for (const delay of (retry?.backoff ?? backoff)()) {
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
    if (++attempts >= maxAttempts) {
      throw new Error(`batchGet exceeded ${maxAttempts} attempts (UnprocessedKeys or throttling persisted)`);
    }
    await sleep(delay);
  }
  // reached only when a custom finite backoff ran dry with work still pending
  throw new Error('batchGet: retry delays exhausted (UnprocessedKeys or throttling persisted)');
};
