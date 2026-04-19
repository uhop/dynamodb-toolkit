// Internal: BatchWriteItem with UnprocessedItems retry + exponential backoff.
// Retries are capped — persistent throttling throws instead of hanging forever.

import {BatchWriteCommand} from '@aws-sdk/lib-dynamodb';
import {backoff} from './backoff.js';
import {sleep} from '../sleep.js';

const MAX_ATTEMPTS = 10;

export const batchWrite = async (client, requestItems) => {
  let params = {RequestItems: requestItems};
  let attempts = 0;
  for (const delay of backoff()) {
    try {
      const data = await client.send(new BatchWriteCommand(params));
      if (!data.UnprocessedItems || !Object.keys(data.UnprocessedItems).length) return;
      params = {RequestItems: data.UnprocessedItems};
    } catch (error) {
      if (error.name !== 'ProvisionedThroughputExceededException') throw error;
    }
    if (++attempts >= MAX_ATTEMPTS) {
      throw new Error(`batchWrite exceeded ${MAX_ATTEMPTS} attempts (UnprocessedItems or throttling persisted)`);
    }
    await sleep(delay);
  }
};
