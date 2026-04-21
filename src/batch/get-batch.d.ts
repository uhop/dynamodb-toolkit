import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/** A read descriptor consumed by {@link getBatch}. */
export interface BatchGetDescriptor {
  /** Always `'get'`. */
  action: 'get';
  /** DynamoDB command input. Must include `TableName` and `Key`. */
  params: Record<string, unknown>;
}

/** One item returned by {@link getBatch}, tagged with its source table. */
export interface BatchGetResult {
  /** Source table name. */
  table: string;
  /** The fetched item. */
  item: Record<string, unknown>;
}

/**
 * Chunk and execute `BatchGetItem` calls (limit 100 per call) with
 * `UnprocessedKeys` retry and exponential backoff. Items are returned in
 * arbitrary order (the SDK doesn't preserve caller order — use
 * `readByKeys` from the `mass` sub-export when order matters).
 *
 * The AWS SDK does **not** resubmit `UnprocessedKeys` — this wrapper does.
 *
 * @param client The DynamoDB DocumentClient.
 * @param requests Descriptors, arrays of descriptors, and/or `null` holes.
 * @returns The fetched items, each tagged with its source table. Order is arbitrary —
 *   misses are simply absent, so the result may be shorter than the request list.
 */
export function getBatch(client: DynamoDBDocumentClient, ...requests: (BatchGetDescriptor | BatchGetDescriptor[] | null)[]): Promise<BatchGetResult[]>;
