// Internal: BatchWriteItem with UnprocessedItems retry + exponential backoff.
// Retries are capped — persistent throttling throws instead of hanging forever.

import {BatchWriteCommand} from '@aws-sdk/lib-dynamodb';
import {backoff} from './backoff.js';
import {sleep} from '../sleep.js';

// With default backoff (cap 20s), 8 attempts yield max ~43s total wait —
// fits AWS's "stop around one minute" guidance for DynamoDB retries.
const MAX_ATTEMPTS = 8;

export const batchWrite = async (client, requestItems, retry) => {
  const maxAttempts = retry?.maxAttempts ?? MAX_ATTEMPTS;
  let params = {RequestItems: requestItems};
  let attempts = 0;
  for (const delay of (retry?.backoff ?? backoff)()) {
    try {
      const data = await client.send(new BatchWriteCommand(params));
      if (!data.UnprocessedItems || !Object.keys(data.UnprocessedItems).length) return;
      params = {RequestItems: data.UnprocessedItems};
    } catch (error) {
      if (error.name !== 'ProvisionedThroughputExceededException') throw error;
    }
    if (++attempts >= maxAttempts) {
      throw new Error(`batchWrite exceeded ${maxAttempts} attempts (UnprocessedItems or throttling persisted)`);
    }
    await sleep(delay);
  }
  // reached only when a custom finite backoff ran dry with work still pending
  throw new Error('batchWrite: retry delays exhausted (UnprocessedItems or throttling persisted)');
};
