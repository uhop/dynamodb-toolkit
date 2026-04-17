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

/** Options for `put`. */
export interface PutOptions {
  /** When `true`, skips the existence check (create-or-replace). */
  force?: boolean;
  /** Extra condition clauses applied on top of the existence check. */
  conditions?: ConditionClause[];
  /** Extra DynamoDB input merged into the Command. */
  params?: Record<string, unknown>;
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
}

/** Options for `delete`. */
export interface DeleteOptions {
  /** Extra condition clauses. DynamoDB Delete is idempotent without them. */
  conditions?: ConditionClause[];
  /** Extra DynamoDB input merged into the Command. */
  params?: Record<string, unknown>;
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
   * Fetch multiple items by key via `BatchGetItem`. Missing keys are silently
   * dropped. Order is not guaranteed.
   *
   * @param keys Keys to fetch.
   * @param fields Optional projection spec.
   * @param options Consistency / revive / indirection / extra params.
   */
  getByKeys(keys: (TKey | Raw<TKey>)[], fields?: string | string[] | null, options?: GetOptions): Promise<TItem[]>;

  /**
   * Paginated list of items, built via the `prepareListInput` hook.
   *
   * @param options Paging / sorting / projection / filter / revive options.
   * @param example Partial example fed to `prepareListInput` (for index lookups).
   * @param index GSI name fed to `prepareListInput`.
   */
  getAll(options?: ListOptions, example?: Partial<TItem>, index?: string): Promise<PaginatedResult<TItem>>;

  /**
   * Paginated list from caller-built DynamoDB params. Skips the
   * `prepareListInput` hook.
   *
   * @param params Pre-built DynamoDB `Query` / `Scan` input.
   * @param options Paging / sorting / revive options.
   */
  getAllByParams(params: Record<string, unknown>, options?: ListOptions): Promise<PaginatedResult<TItem>>;

  // --- Writes — single ---

  /**
   * Create-only write. Adds `attribute_not_exists(<partition key>)`.
   * @throws `ConditionalCheckFailedException` when the key already exists.
   */
  post(item: TItem | Raw<TItem>): Promise<unknown>;

  /**
   * Create-or-replace write. Default adds `attribute_exists(<partition key>)`
   * (write fails if missing); `options.force` skips the check.
   */
  put(item: TItem | Raw<TItem>, options?: PutOptions): Promise<unknown>;

  /**
   * Partial update via `UpdateExpression`. Key fields are stripped from
   * `patch` automatically.
   *
   * @param key Item key.
   * @param patch Fields to SET (dotted paths supported).
   * @param options Deletion paths, array ops, extra conditions, separator.
   */
  patch(key: TKey | Raw<TKey>, patch: Partial<TItem> | Raw<Partial<TItem>>, options?: PatchOptions): Promise<unknown>;

  /**
   * Delete an item by key. DynamoDB Delete is idempotent; succeeds whether
   * or not the item exists (unless `options.conditions` is supplied).
   */
  delete(key: TKey | Raw<TKey>, options?: DeleteOptions): Promise<unknown>;

  /**
   * Read an item, apply `mapFn`, write the result back. Returns the cloned
   * item on success, `undefined` when the source is missing.
   *
   * @param key Source item key.
   * @param mapFn Transform from source item to destination item. Default identity.
   * @param options `force` swaps the destination write from `post` to `put({force})`.
   */
  clone(key: TKey | Raw<TKey>, mapFn?: (item: TItem) => TItem, options?: CloneOptions): Promise<TItem | undefined>;

  /**
   * `clone` + delete the source — bundled into a single `TransactWriteItems`.
   * Returns the moved item on success, `undefined` when the source is missing.
   */
  move(key: TKey | Raw<TKey>, mapFn?: (item: TItem) => TItem, options?: MoveOptions): Promise<TItem | undefined>;

  // --- Writes — mass ---

  /**
   * Bulk write. `'native'` strategy (default) uses `BatchWriteItem`;
   * `'sequential'` does individual Puts per item.
   */
  putAll(items: (TItem | Raw<TItem>)[], options?: MassOptions): Promise<{processed: number}>;
  /** Bulk delete by known keys. */
  deleteByKeys(keys: (TKey | Raw<TKey>)[], options?: MassOptions): Promise<{processed: number}>;
  /** Delete every item matching `params` (Query / Scan). */
  deleteAllByParams(params: Record<string, unknown>, options?: MassOptions): Promise<{processed: number}>;
  /** Clone each item identified by a key, optionally transformed by `mapFn`. */
  cloneByKeys(keys: (TKey | Raw<TKey>)[], mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  /** Clone every item matching `params`, optionally transformed by `mapFn`. */
  cloneAllByParams(params: Record<string, unknown>, mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  /** Move each item identified by a key (paired put + delete chunks). */
  moveByKeys(keys: (TKey | Raw<TKey>)[], mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  /** Move every item matching `params` (paired put + delete chunks). */
  moveAllByParams(params: Record<string, unknown>, mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;

  // --- Batch builders ---

  /**
   * Build a `get` descriptor for use with `getBatch` / `getTransaction`.
   * Carries a reference to this Adapter for result routing.
   */
  makeGet(key: TKey | Raw<TKey>, fields?: string | string[] | null, params?: Record<string, unknown>): Promise<BatchDescriptor & {action: 'get'}>;
  /** Build a condition-only descriptor for `applyTransaction`. */
  makeCheck(key: TKey | Raw<TKey>, params?: Record<string, unknown>): Promise<BatchDescriptor & {action: 'check'}>;
  /** Build a `put` descriptor with an `attribute_not_exists` condition. */
  makePost(item: TItem | Raw<TItem>): Promise<BatchDescriptor & {action: 'put'}>;
  /** Build a `put` descriptor (with `attribute_exists` unless `force`). */
  makePut(item: TItem | Raw<TItem>, options?: PutOptions): Promise<BatchDescriptor & {action: 'put'}>;
  /** Build a `patch` descriptor (`UpdateExpression`). */
  makePatch(key: TKey | Raw<TKey>, patch: Partial<TItem> | Raw<Partial<TItem>>, options?: PatchOptions): Promise<BatchDescriptor & {action: 'patch'}>;
  /** Build a `delete` descriptor. */
  makeDelete(key: TKey | Raw<TKey>, options?: DeleteOptions): Promise<BatchDescriptor & {action: 'delete'}>;
}
