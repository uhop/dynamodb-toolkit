import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/** A read descriptor consumed by {@link getTransaction}. */
export interface TransactGetDescriptor {
  /** Always `'get'`. */
  action: 'get';
  /** DynamoDB command input. Must include `TableName` and `Key`. */
  params: Record<string, unknown>;
  /** Optional caller-provided routing tag (e.g. the source Adapter). Echoed back in the result. */
  adapter?: unknown;
}

/** One item returned by {@link getTransaction}, preserving caller order. */
export interface TransactGetResult {
  /** Source table name. */
  table: string;
  /** The fetched item, or `null` on miss. */
  item: Record<string, unknown> | null;
  /** Whatever was supplied as `adapter` on the matching descriptor. */
  adapter?: unknown;
}

/**
 * Execute a single `TransactGetItems` call. Up to 100 items; results come
 * back in call order with `null` items for misses.
 *
 * @param client The DynamoDB DocumentClient.
 * @param requests Descriptors, arrays of descriptors, and/or `null` holes.
 */
export function getTransaction(
  client: DynamoDBDocumentClient,
  ...requests: (TransactGetDescriptor | TransactGetDescriptor[] | null)[]
): Promise<TransactGetResult[]>;
