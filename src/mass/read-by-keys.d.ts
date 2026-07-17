import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import type {RetryOptions} from '../batch/backoff.js';

/**
 * Batch-read items by key and return them in the caller's input-key order.
 * Length-preserving: `result[i]` corresponds to `keys[i]`, with `undefined` at
 * positions whose key had no matching item.
 *
 * This is a bulk-individual-read helper — the plural form of `getByKey` — not
 * a list operation. The caller defines the set of items to fetch (via `keys`)
 * and the order of the result; this helper orchestrates a `BatchGetItem`
 * round trip under the hood and realigns the arbitrary-order SDK response to
 * caller intent.
 *
 * @param client The DynamoDB DocumentClient.
 * @param tableName Table to read from.
 * @param keys Keys to fetch, in the desired result order.
 * @param params Extra DynamoDB input merged into each sub-request (e.g.
 *   `ConsistentRead`, `ProjectionExpression`).
 * @param retry Retry policy override for the underlying batch reads.
 * @returns Array aligned 1:1 with `keys` — `result[i]` is the item for
 *   `keys[i]`, or `undefined` when that key had no matching item.
 */
export function readByKeys<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
  params?: Record<string, unknown>,
  retry?: RetryOptions
): Promise<(T | undefined)[]>;
