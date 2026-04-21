import type {DynamoDBDocumentClient, GetCommandInput, PutCommandInput, UpdateCommandInput, DeleteCommandInput} from '@aws-sdk/lib-dynamodb';

import type {Raw} from '../raw.js';
import type {ArrayOp} from '../expressions/update.js';
import type {ConditionClause} from '../expressions/condition.js';
import type {PaginatedResult} from '../mass/paginate-list.js';
import type {AdapterHooks} from './hooks.js';

/** Constructor options for {@link Adapter}. */
export interface AdapterOptions<TItem extends Record<string, unknown>, _TKey = Partial<TItem>> {
  /** The DynamoDB DocumentClient. Build via `DynamoDBDocumentClient.from(...)`. */
  client: DynamoDBDocumentClient;
  /** Base table name. */
  table: string;
  /** Partition key first, optional sort key second. */
  keyFields: (keyof TItem & string)[];
  /** Alias map for projections — rewrites the first segment of each requested field. */
  projectionFieldMap?: Record<string, string>;
  /** Fields that get a `searchablePrefix + field` lowercase mirror for substring filtering. */
  searchable?: Record<string, 1 | true>;
  /** Mirror-column prefix. Default `'-search-'`. */
  searchablePrefix?: string;
  /** GSIs that project keys only — reads do a second-hop BatchGet against the base table. */
  indirectIndices?: Record<string, 1 | true>;
  /** Per-instance hook overrides; merges over {@link defaultHooks}. */
  hooks?: AdapterHooks<TItem>;
}

/** Options for read methods. */
export interface GetOptions {
  /** Strong consistency. */
  consistent?: boolean;
  /** When `false`, return the raw item wrapped in `Raw<T>` instead of running `revive`. */
  reviveItems?: boolean;
  /** Skip the indirect-index second-hop even if the index is configured as indirect. */
  ignoreIndirection?: boolean;
  /** Extra DynamoDB input merged into the Command (e.g. `IndexName`, `ConsistentRead`). */
  params?: Record<string, unknown>;
}

/** Options for `post`. */
export interface PostOptions {
  /**
   * When `true`, sets `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'`. If the
   * `attribute_not_exists` check fails, the thrown `ConditionalCheckFailedException`
   * carries the existing item on its `Item` field — useful for "tell me what I
   * collided with" debugging.
   */
  returnFailedItem?: boolean;
}

/** Options for `put`. */
export interface PutOptions {
  /** When `true`, skips the existence check (create-or-replace). */
  force?: boolean;
  /** Extra condition clauses applied on top of the existence check. */
  conditions?: ConditionClause[];
  /** Extra DynamoDB input merged into the Command. */
  params?: Record<string, unknown>;
  /**
   * When `true`, sets `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'`. The
   * thrown `ConditionalCheckFailedException` carries the item that failed the
   * check on its `Item` field.
   */
  returnFailedItem?: boolean;
}

/** Options for `patch`. */
export interface PatchOptions {
  /** Paths to REMOVE from the item. */
  delete?: string[];
  /** Path separator. Default `'.'`. */
  separator?: string;
  /** Atomic array / Set operations. */
  arrayOps?: ArrayOp[];
  /** Extra condition clauses. */
  conditions?: ConditionClause[];
  /** Extra DynamoDB input merged into the Command. */
  params?: Record<string, unknown>;
  /**
   * When `true`, sets `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'`. The
   * thrown `ConditionalCheckFailedException` carries the item that failed the
   * check on its `Item` field.
   */
  returnFailedItem?: boolean;
}

/** Options for `delete`. */
export interface DeleteOptions {
  /** Extra condition clauses. DynamoDB Delete is idempotent without them. */
  conditions?: ConditionClause[];
  /** Extra DynamoDB input merged into the Command. */
  params?: Record<string, unknown>;
  /**
   * When `true`, sets `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'`. The
   * thrown `ConditionalCheckFailedException` carries the item that failed the
   * check on its `Item` field.
   */
  returnFailedItem?: boolean;
}

/** Options for `clone`. */
export interface CloneOptions {
  /** When `true`, the destination write uses `put({force: true})` instead of `post`. */
  force?: boolean;
  /** Extra DynamoDB input merged into the Command. */
  params?: Record<string, unknown>;
  /** When `false`, the source read returns `Raw<T>`. */
  reviveItems?: boolean;
  /** Skip the indirect-index second-hop on the source read. */
  ignoreIndirection?: boolean;
}

/** Options for `move`. Same shape as {@link CloneOptions}. */
export interface MoveOptions extends CloneOptions {}

/** Options for mass write operations. */
export interface MassOptions {
  /**
   * `'native'` (default) uses `BatchWriteItem` / `BatchGetItem` for throughput.
   * `'sequential'` does individual Commands per item — slower, but each goes
   * through the single-op path (so per-item conditions and `checkConsistency`
   * work as expected).
   */
  strategy?: 'native' | 'sequential';
  /** Extra DynamoDB input merged into the Command. */
  params?: Record<string, unknown>;
}

/** Options for list reads (`getAll` / `getAllByParams`). */
export interface ListOptions {
  /** Zero-based starting offset. Default `0`. */
  offset?: number;
  /** Maximum items per page. Default `10`. */
  limit?: number;
  /** Descending sort (reverses `ScanIndexForward`). */
  descending?: boolean;
  /** Strong consistency. */
  consistent?: boolean;
  /** Field spec for projection. */
  fields?: string | string[] | null;
  /** Substring filter over `searchable` fields. */
  filter?: string;
  /** Mirror-column prefix override for the filter. Default `'-search-'`. */
  prefix?: string;
  /** When `true`, the filter query is not lowercased. */
  caseSensitive?: boolean;
  /** When `false`, skip the `Select: 'COUNT'` pass and omit `total`. Default `true`. */
  needTotal?: boolean;
  /** When `false`, return items wrapped in `Raw<T>`. */
  reviveItems?: boolean;
  /** Skip the indirect-index second-hop. */
  ignoreIndirection?: boolean;
}

/**
 * A write or read descriptor returned by the Adapter's `make*` builders.
 * Discriminated on `action`:
 * - `get` — for `getBatch` / `getTransaction` (carries a back-reference to the Adapter)
 * - `check` — condition-only, for `applyTransaction`
 * - `put` / `patch` / `delete` — for `applyBatch` / `applyTransaction`
 */
export type BatchDescriptor =
  | {action: 'get'; adapter: Adapter<Record<string, unknown>>; params: GetCommandInput}
  | {action: 'check'; params: GetCommandInput}
  | {action: 'put'; params: PutCommandInput}
  | {action: 'patch'; params: UpdateCommandInput}
  | {action: 'delete'; params: DeleteCommandInput};

/**
 * The toolkit's composition root. Construct one per logical entity (usually
 * per table). Owns the client, table name, keyFields, searchable / indirect
 * index config, and the hooks bag. Delegates real work to the
 * `expressions` / `batch` / `mass` / `paths` sub-exports.
 */
export class Adapter<TItem extends Record<string, unknown>, TKey = Partial<TItem>> {
  /** The DynamoDB DocumentClient supplied at construction. */
  client: DynamoDBDocumentClient;
  /** Base table name. */
  table: string;
  /** Partition key first, optional sort key second. */
  keyFields: (keyof TItem & string)[];
  /** Alias map for projections. */
  projectionFieldMap: Record<string, string>;
  /** Searchable-field map for substring filtering. */
  searchable: Record<string, 1 | true>;
  /** Mirror-column prefix. Default `'-search-'`. */
  searchablePrefix: string;
  /** Indirect-index map — reads against these GSIs do a second-hop BatchGet. */
  indirectIndices: Record<string, 1 | true>;
  /** Resolved hooks bag (defaults merged with user overrides). */
  hooks: Required<AdapterHooks<TItem>>;

  /**
   * @param options Adapter constructor options. `client`, `table`, and
   *   a non-empty `keyFields` are required.
   */
  constructor(options: AdapterOptions<TItem, TKey>);

  // --- Reads ---

  /**
   * Fetch a single item by key. With an indirect-index hit, automatically
   * performs a second-hop BatchGet against the base table.
   *
   * @param key The item's key (wrap in `raw(...)` to skip `prepareKey`).
   * @param fields Optional projection spec.
   * @param options Consistency / revive / indirection / extra params.
   * @returns The item, or `undefined` on miss.
   */
  getByKey(key: TKey | Raw<TKey>, fields?: string | string[] | null, options?: GetOptions): Promise<TItem | undefined>;

  /**
   * Fetch multiple items by key via `BatchGetItem`. Bulk-individual read — the
   * caller supplies the set and the order; the result is length-preserving
   * with `undefined` at positions whose key had no matching item. With an
   * indirect-index hit, automatically performs a second-hop BatchGet against
   * the base table.
   *
   * @param keys Keys to fetch, in the desired result order.
   * @param fields Optional projection spec.
   * @param options Consistency / revive / indirection / extra params.
   * @returns Array aligned 1:1 with `keys` — `result[i]` is the revived item
   *   for `keys[i]`, or `undefined` when that key had no matching item.
   *   Callers who want a compact array call `.filter(Boolean)` themselves.
   */
  getByKeys(keys: (TKey | Raw<TKey>)[], fields?: string | string[] | null, options?: GetOptions): Promise<(TItem | undefined)[]>;

  /**
   * Paginated list of items, built via the `prepareListInput` hook.
   *
   * @param options Paging / sorting / projection / filter / revive options.
   * @param example Partial example fed to `prepareListInput` (for index lookups).
   * @param index GSI name fed to `prepareListInput`.
   * @returns One page: `data` has up to `limit` items (revived unless `reviveItems: false`),
   *   `offset`/`limit` echo the clamped window, `total` is present unless `needTotal: false`.
   */
  getAll(options?: ListOptions, example?: Partial<TItem>, index?: string): Promise<PaginatedResult<TItem>>;

  /**
   * Paginated list from caller-built DynamoDB params. Skips the
   * `prepareListInput` hook.
   *
   * @param params Pre-built DynamoDB `Query` / `Scan` input.
   * @param options Paging / sorting / revive options.
   * @returns Same envelope shape as {@link Adapter.getAll} — a single page of items plus
   *   `offset`/`limit`/optional `total`.
   */
  getAllByParams(params: Record<string, unknown>, options?: ListOptions): Promise<PaginatedResult<TItem>>;

  // --- Writes — single ---

  /**
   * Create-only write. Adds `attribute_not_exists(<partition key>)`.
   *
   * @param item Item to insert (wrap in `raw(...)` to skip `prepare` / `validateItem`).
   * @param options `returnFailedItem` to surface the colliding item on check failure.
   * @returns The raw DynamoDB Command output — or the transaction output when
   *   `hooks.checkConsistency` upgrades the write. Callers usually ignore it.
   * @throws `ConditionalCheckFailedException` when the key already exists.
   */
  post(item: TItem | Raw<TItem>, options?: PostOptions): Promise<unknown>;

  /**
   * Create-or-replace write. Default adds `attribute_exists(<partition key>)`
   * (write fails if missing); `options.force` skips the check.
   *
   * @param item Item to write (wrap in `raw(...)` to skip `prepare` / `validateItem`).
   * @param options `force`, extra conditions, extra DynamoDB input.
   * @returns The raw DynamoDB Command output (or transaction output when upgraded).
   */
  put(item: TItem | Raw<TItem>, options?: PutOptions): Promise<unknown>;

  /**
   * Partial update via `UpdateExpression`. Key fields are stripped from
   * `patch` automatically.
   *
   * @param key Item key.
   * @param patch Fields to SET (dotted paths supported).
   * @param options Deletion paths, array ops, extra conditions, separator.
   * @returns The raw DynamoDB Command output (or transaction output when upgraded).
   */
  patch(key: TKey | Raw<TKey>, patch: Partial<TItem> | Raw<Partial<TItem>>, options?: PatchOptions): Promise<unknown>;

  /**
   * Delete an item by key. DynamoDB Delete is idempotent; succeeds whether
   * or not the item exists (unless `options.conditions` is supplied).
   *
   * @param key Item key.
   * @param options Extra condition clauses, extra DynamoDB input.
   * @returns The raw DynamoDB Command output (or transaction output when upgraded).
   */
  delete(key: TKey | Raw<TKey>, options?: DeleteOptions): Promise<unknown>;

  /**
   * Read an item, apply `mapFn`, write the result back. Returns the cloned
   * item on success, `undefined` when the source is missing.
   *
   * @param key Source item key.
   * @param mapFn Transform from source item to destination item. Default identity.
   * @param options `force` swaps the destination write from `post` to `put({force})`.
   * @returns The written (post-`mapFn`) item, or `undefined` when the source key missed.
   */
  clone(key: TKey | Raw<TKey>, mapFn?: (item: TItem) => TItem, options?: CloneOptions): Promise<TItem | undefined>;

  /**
   * `clone` + delete the source — bundled into a single `TransactWriteItems`.
   * Returns the moved item on success, `undefined` when the source is missing.
   *
   * @param key Source item key.
   * @param mapFn Transform from source to destination. Default identity.
   * @param options Same shape as {@link CloneOptions}.
   * @returns The written (post-`mapFn`) item, or `undefined` when the source key missed.
   */
  move(key: TKey | Raw<TKey>, mapFn?: (item: TItem) => TItem, options?: MoveOptions): Promise<TItem | undefined>;

  // --- Writes — mass ---

  /**
   * Bulk write. `'native'` strategy (default) uses `BatchWriteItem`;
   * `'sequential'` does individual Puts per item.
   *
   * @param items Items to write.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — total writes DynamoDB accepted across every underlying
   *   batch call (or every per-item Command in sequential mode).
   */
  putAll(items: (TItem | Raw<TItem>)[], options?: MassOptions): Promise<{processed: number}>;
  /**
   * Bulk delete by known keys.
   *
   * @param keys Keys to delete.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — total delete actions DynamoDB accepted (missing items count too).
   */
  deleteByKeys(keys: (TKey | Raw<TKey>)[], options?: MassOptions): Promise<{processed: number}>;
  /**
   * Delete every item matching `params` (Query / Scan).
   *
   * @param params Pre-built DynamoDB `Query` / `Scan` input.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — total delete actions DynamoDB accepted.
   */
  deleteAllByParams(params: Record<string, unknown>, options?: MassOptions): Promise<{processed: number}>;
  /**
   * Clone each item identified by a key, optionally transformed by `mapFn`.
   *
   * @param keys Source keys.
   * @param mapFn Transform applied before writing the copy. Default identity.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — total copies written.
   */
  cloneByKeys(keys: (TKey | Raw<TKey>)[], mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  /**
   * Clone every item matching `params`, optionally transformed by `mapFn`.
   *
   * @param params Pre-built `Query` / `Scan` input.
   * @param mapFn Transform applied before writing the copy. Default identity.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — total copies written.
   */
  cloneAllByParams(params: Record<string, unknown>, mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  /**
   * Move each item identified by a key (paired put + delete chunks).
   *
   * @param keys Source keys.
   * @param mapFn Transform applied before writing the destination. Default identity.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — sum of put + delete actions (≈ 2× the moved-item count on success).
   */
  moveByKeys(keys: (TKey | Raw<TKey>)[], mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  /**
   * Move every item matching `params` (paired put + delete chunks).
   *
   * @param params Pre-built `Query` / `Scan` input.
   * @param mapFn Transform applied before writing the destination. Default identity.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — sum of put + delete actions (≈ 2× the moved-item count on success).
   */
  moveAllByParams(params: Record<string, unknown>, mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;

  // --- Batch builders ---

  /**
   * Build a `get` descriptor for use with `getBatch` / `getTransaction`.
   * Carries a reference to this Adapter for result routing.
   *
   * @param key Item key.
   * @param fields Optional projection spec.
   * @param params Extra DynamoDB input merged into the descriptor.
   * @returns A `{action: 'get', adapter, params}` descriptor ready to pass to
   *   `getBatch` / `getTransaction`. `adapter` is this instance, so multi-table
   *   transactions can revive each result against the right Adapter.
   */
  makeGet(key: TKey | Raw<TKey>, fields?: string | string[] | null, params?: Record<string, unknown>): Promise<BatchDescriptor & {action: 'get'}>;
  /**
   * Build a condition-only descriptor for `applyTransaction`.
   *
   * @param key Item key the check runs against.
   * @param params Extra DynamoDB input (typically `ConditionExpression`).
   * @returns A `{action: 'check', params}` descriptor — include in a transaction to
   *   abort the whole thing when the condition fails.
   */
  makeCheck(key: TKey | Raw<TKey>, params?: Record<string, unknown>): Promise<BatchDescriptor & {action: 'check'}>;
  /**
   * Build a `put` descriptor with an `attribute_not_exists` condition.
   *
   * @param item Item to insert.
   * @param options `returnFailedItem` to surface the colliding item on check failure.
   * @returns A `{action: 'put', params}` descriptor ready for `applyBatch` / `applyTransaction`.
   *   The transaction fails if the key already exists.
   */
  makePost(item: TItem | Raw<TItem>, options?: PostOptions): Promise<BatchDescriptor & {action: 'put'}>;
  /**
   * Build a `put` descriptor (with `attribute_exists` unless `force`).
   *
   * @param item Item to write.
   * @param options `force`, extra conditions, extra DynamoDB input.
   * @returns A `{action: 'put', params}` descriptor.
   */
  makePut(item: TItem | Raw<TItem>, options?: PutOptions): Promise<BatchDescriptor & {action: 'put'}>;
  /**
   * Build a `patch` descriptor (`UpdateExpression`).
   *
   * @param key Item key.
   * @param patch Fields to SET.
   * @param options Deletion paths, array ops, extra conditions, separator.
   * @returns A `{action: 'patch', params}` descriptor carrying the built `UpdateExpression`.
   */
  makePatch(key: TKey | Raw<TKey>, patch: Partial<TItem> | Raw<Partial<TItem>>, options?: PatchOptions): Promise<BatchDescriptor & {action: 'patch'}>;
  /**
   * Build a `delete` descriptor.
   *
   * @param key Item key.
   * @param options Extra condition clauses, extra DynamoDB input.
   * @returns A `{action: 'delete', params}` descriptor.
   */
  makeDelete(key: TKey | Raw<TKey>, options?: DeleteOptions): Promise<BatchDescriptor & {action: 'delete'}>;
}
