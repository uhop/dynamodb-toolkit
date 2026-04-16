// Internal: BatchWriteItem with UnprocessedItems retry + exponential backoff.

import {BatchWriteCommand} from '@aws-sdk/lib-dynamodb';
import {backoff} from './backoff.js';
import {sleep} from '../sleep.js';

export const batchWrite = async (client, requestItems) => {
  let params = {RequestItems: requestItems};
  for (const delay of backoff()) {
    try {
      const data = await client.send(new BatchWriteCommand(params));
      if (!data.UnprocessedItems || !Object.keys(data.UnprocessedItems).length) break;
      params = {RequestItems: data.UnprocessedItems};
    } catch (error) {
      if (error.name !== 'ProvisionedThroughputExceededException') throw error;
    }
    await sleep(delay);
  }
};
