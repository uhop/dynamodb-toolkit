import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

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

/**
 * Chunk and execute `BatchWriteItem` calls (limit 25 per call) with
 * `UnprocessedItems` retry and exponential backoff. Accepts descriptors as
 * positional args, arrays of descriptors, or `null` (skipped).
 *
 * The AWS SDK does **not** resubmit `UnprocessedItems` — this wrapper does.
 *
 * @param client The DynamoDB DocumentClient.
 * @param requests Descriptors, arrays of descriptors, and/or `null` holes.
 * @returns Number of items successfully processed.
 */
export function applyBatch(client: DynamoDBDocumentClient, ...requests: (BatchWriteDescriptor | BatchWriteDescriptor[] | null)[]): Promise<number>;
