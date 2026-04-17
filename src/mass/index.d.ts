/**
 * Mass operations — paginated reads, batch reads-by-key, bulk writes, and
 * copy/move primitives. Used internally by the Adapter but callable standalone
 * when you only want a slice of the toolkit.
 */

export {paginateList, type PaginateOptions, type PaginatedResult} from './paginate-list.js';
export {iterateList, iterateItems} from './iterate-list.js';
export {readOrderedListByKeys} from './read-ordered-list-by-keys.js';

import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/**
 * Read a single page from a `Query` or `Scan`, pass it to `fn`, and return
 * next-page params (or `null` when exhausted).
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @param fn Async callback invoked with the raw response page.
 */
export function readList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  fn: (data: Record<string, unknown>) => Promise<void>
): Promise<Record<string, unknown> | null>;

/**
 * Read a single page and return `{nextParams, items}` — items for this page,
 * `nextParams` for a subsequent call, `null` when exhausted.
 */
export function readListGetItems(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>
): Promise<{nextParams: Record<string, unknown> | null; items: Record<string, unknown>[]}>;

/**
 * Batch-read items by key. Uses {@link getBatch} under the hood. Returns items
 * in an arbitrary order — use `readOrderedListByKeys` when order matters.
 *
 * @param client The DynamoDB DocumentClient.
 * @param tableName Table to read from.
 * @param keys Keys to fetch.
 * @param params Extra DynamoDB input merged into each sub-request.
 */
export function readListByKeys<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
  params?: Record<string, unknown>
): Promise<T[]>;

/**
 * Bulk-write items via chunked `BatchWriteItem`.
 *
 * @param client The DynamoDB DocumentClient.
 * @param tableName Target table.
 * @param items Items to write.
 * @param mapFn Optional transform applied to each item before writing.
 *   Returning a falsy value skips that item.
 * @returns Number of items written.
 */
export function writeList(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
  mapFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

/**
 * Delete items matching a `Query` / `Scan`. Reads pages, extracts each item's
 * key via `keyFn`, and batch-deletes.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input (must include key projection).
 * @param keyFn Extracts the key from each fetched item. Default: identity.
 * @returns Number of items deleted.
 */
export function deleteList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  keyFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

/**
 * Batch-delete a known list of keys.
 *
 * @param client The DynamoDB DocumentClient.
 * @param tableName Target table.
 * @param keys Keys to delete.
 * @returns Number of items deleted.
 */
export function deleteListByKeys(client: DynamoDBDocumentClient, tableName: string, keys: Record<string, unknown>[]): Promise<number>;

/**
 * Copy items matching a `Query` / `Scan` back into the same table, optionally
 * transformed by `mapFn`.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input. The target table is taken from `params.TableName`.
 * @param mapFn Transform applied to each fetched item before writing the copy.
 * @returns Number of items written.
 */
export function copyList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  mapFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

/**
 * Move items matching a `Query` / `Scan` — put the transformed copy, then
 * delete the original. Paired 12 puts + 12 deletes per `BatchWrite` chunk
 * (24 ≤ 25 batch-write limit).
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @param mapFn Transform applied to each fetched item before writing.
 * @param keyFn Extracts the original key from each fetched item (for the delete leg).
 * @returns Total batch-actions count (puts + deletes).
 */
export function moveList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  mapFn?: (item: Record<string, unknown>) => Record<string, unknown>,
  keyFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

/**
 * Count items matching a `Query` / `Scan` via `Select: 'COUNT'` pagination.
 * Traverses every page — O(result size).
 */
export function getTotal(client: DynamoDBDocumentClient, params: Record<string, unknown>): Promise<number>;
