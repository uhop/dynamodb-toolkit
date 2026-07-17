import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import type {RetryOptions} from './backoff.js';

/** A write descriptor consumed by {@link applyBatch}. */
export interface BatchWriteDescriptor {
  /** Write kind — `'put'` inserts/replaces, `'delete'` removes by key. */
  action: 'put' | 'delete';
  /**
   * DynamoDB command input. Must include `TableName` and either `Item`
   * (for `put`) or `Key` (for `delete`).
   */
  params: Record<string, unknown>;
}

/** Options sentinel accepted among {@link applyBatch} requests — mirrors `applyTransaction`'s. */
export interface BatchWriteOptionsDescriptor {
  options: {
    /** Retry policy for this call. Default: `backoff()` schedule, 8 attempts. */
    retry?: RetryOptions;
  };
}

/**
 * Chunk and execute `BatchWriteItem` calls (limit 25 per call) with
 * `UnprocessedItems` retry and exponential backoff. Accepts descriptors as
 * positional args, arrays of descriptors, `{options: ...}` sentinels, or
 * `null` (skipped).
 *
 * The AWS SDK does **not** resubmit `UnprocessedItems` — this wrapper does.
 *
 * @param client The DynamoDB DocumentClient.
 * @param requests Descriptors, arrays of descriptors, `{options}` sentinels, and/or `null` holes.
 * @returns Total count of writes that DynamoDB accepted across every underlying
 *   `BatchWriteItem` call (sum of puts + deletes, including retried ones).
 */
export function applyBatch(
  client: DynamoDBDocumentClient,
  ...requests: (BatchWriteDescriptor | BatchWriteOptionsDescriptor | (BatchWriteDescriptor | BatchWriteOptionsDescriptor)[] | null | undefined | false)[]
): Promise<number>;
