import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/**
 * Batch-read items by key and return them in the caller's key order.
 * `BatchGetItem` normally returns items in arbitrary order — this helper
 * rebuilds the original order. Missing keys become `undefined` entries.
 *
 * @param client The DynamoDB DocumentClient.
 * @param tableName Table to read from.
 * @param keys Keys in the desired result order.
 * @param params Extra DynamoDB input merged into each sub-request
 *   (e.g. `ConsistentRead`, `ProjectionExpression`).
 */
export function readOrderedListByKeys<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
  params?: Record<string, unknown>
): Promise<(T | undefined)[]>;
