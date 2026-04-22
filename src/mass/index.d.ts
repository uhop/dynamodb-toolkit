/**
 * Mass operations — three categories:
 *
 * 1. **Individual ops** on single items live on the Adapter (`get`, `put`,
 *    `post`, `patch`, `delete`, `clone`, `move`).
 * 2. **Bulk-individual ops** take N caller-supplied items or keys and batch
 *    them for efficiency. The caller defines the set; the helper returns a
 *    result aligned to that set. `readByKeys`, `writeItems`, `deleteByKeys`.
 * 3. **List ops** (read or consume) use `Query` / `Scan` — the database
 *    produces the set. Read-shaped: `readList`, `iterateList`,
 *    `paginateList`, `getTotal`. Consume-shaped: `deleteList`, `copyList`,
 *    `moveList` — walk pages and apply a per-item op.
 *
 * Naming follows the categories: "List" in a helper name means
 * DB-produces-set; bulk-individual helpers drop "List" because the caller
 * supplies the items. See `topics/bulk-individual-vs-list-operations.md` in
 * the knowledge vault for the design rationale.
 */

export {paginateList, type PaginateOptions, type PaginatedResult} from './paginate-list.js';
export {iterateList, iterateItems} from './iterate-list.js';
export {readByKeys} from './read-by-keys.js';
export {writeItems} from './write-items.js';
export {mergeMapFn, type MapFn} from './map-fns.js';

import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/**
 * Read a single page from a `Query` or `Scan`, pass it to `fn`, and return
 * next-page params (or `null` when exhausted).
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @param fn Async callback invoked with the raw response page.
 * @returns Params to pass on the next call to continue paging, or `null` when the scan
 *   is exhausted (no `LastEvaluatedKey` in the last response).
 */
export function readList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  fn: (data: Record<string, unknown>) => Promise<void>
): Promise<Record<string, unknown> | null>;

/**
 * Read a single page and return `{nextParams, items}` — items for this page,
 * `nextParams` for a subsequent call, `null` when exhausted.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @returns `items` for this page, and `nextParams` to continue (or `null` when exhausted).
 */
export function readListGetItems(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>
): Promise<{nextParams: Record<string, unknown> | null; items: Record<string, unknown>[]}>;

/**
 * Delete items matching a `Query` / `Scan`. Reads pages, extracts each item's
 * key via `keyFn`, and batch-deletes.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input (must include key projection).
 * @param keyFn Extracts the key from each fetched item. Default: identity.
 * @returns Count of items DynamoDB removed (sum across every chunked `BatchWriteItem` call).
 */
export function deleteList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  keyFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

/**
 * Batch-delete a known list of keys. The caller supplies the identities;
 * DynamoDB-side deletes are idempotent (missing items succeed).
 *
 * @param client The DynamoDB DocumentClient.
 * @param tableName Target table.
 * @param keys Keys to delete.
 * @returns Count of delete operations DynamoDB accepted.
 */
export function deleteByKeys(client: DynamoDBDocumentClient, tableName: string, keys: Record<string, unknown>[]): Promise<number>;

/**
 * Copy items matching a `Query` / `Scan` back into the same table, optionally
 * transformed by `mapFn`.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input. The target table is taken from `params.TableName`.
 * @param mapFn Transform applied to each fetched item before writing the copy.
 * @returns Count of copies written to the target table.
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
 * @returns Sum of puts + deletes DynamoDB accepted — roughly double the item count
 *   when the move succeeds on every item.
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
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @returns Total number of matches across all pages (post-filter when `FilterExpression` is set).
 */
export function getTotal(client: DynamoDBDocumentClient, params: Record<string, unknown>): Promise<number>;

// Deprecated aliases — removed in a future minor (3.3.0 or 4.0.0).

/** @deprecated Use `readByKeys`. This alias is removed in a future minor. */
export function readListByKeys<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
  params?: Record<string, unknown>
): Promise<(T | undefined)[]>;

/** @deprecated Use `readByKeys` (same behaviour, new name). Removed in a future minor. */
export function readOrderedListByKeys<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
  params?: Record<string, unknown>
): Promise<(T | undefined)[]>;

/** @deprecated Use `deleteByKeys`. This alias is removed in a future minor. */
export function deleteListByKeys(client: DynamoDBDocumentClient, tableName: string, keys: Record<string, unknown>[]): Promise<number>;

/** @deprecated Use `writeItems` (same behaviour, new name — bulk-individual write, not a list op). Removed in a future minor. */
export function writeList(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
  mapFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;
