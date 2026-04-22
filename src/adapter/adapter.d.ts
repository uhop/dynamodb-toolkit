import type {DynamoDBDocumentClient, GetCommandInput, PutCommandInput, UpdateCommandInput, DeleteCommandInput} from '@aws-sdk/lib-dynamodb';
import type {MassOpResult} from '../mass/index.js';

import type {Raw} from '../raw.js';
import type {ArrayOp} from '../expressions/update.js';
import type {ConditionClause} from '../expressions/condition.js';
import type {PaginatedResult} from '../mass/paginate-list.js';
import type {AdapterHooks} from './hooks.js';

/**
 * Typed descriptor for a `keyFields` component. `width` is required for
 * `{type: 'number'}` in a composite `keyFields` (to preserve lexicographic
 * sort on the joined structural key).
 */
export interface KeyFieldSpec {
  /** Field name on the item. */
  name: string;
  /** DynamoDB scalar type for this key. Defaults to `'string'`. */
  type?: 'string' | 'number' | 'binary';
  /** Zero-pad width — required on `{type: 'number'}` components in a composite `keyFields`. */
  width?: number;
}

/**
 * Declaration of the structural (composite) key field. Required when
 * `keyFields.length > 1`. The named field is where the joined component
 * values are stored; the `separator` string is used to join them.
 */
export interface StructuralKey {
  /** Field name on the item where the joined value lives. */
  name: string;
  /** Join separator. Defaults to `'|'`. Any string accepted (multi-char, unprintable). */
  separator?: string;
}

/**
 * Descriptor for a GSI / LSI partition-key or sort-key attribute. Simpler
 * than {@link KeyFieldSpec} — no `width`, since index keys aren't joined
 * (DynamoDB sorts them natively by declared type).
 */
export interface IndexKeySpec {
  /** Attribute name on the item. */
  name: string;
  /** DynamoDB scalar type. Defaults to `'string'`. */
  type?: 'string' | 'number' | 'binary';
}

/**
 * Declaration of a secondary index. Discriminated by `type`:
 * - `'gsi'` — global secondary index. `pk` required; `sk` optional.
 * - `'lsi'` — local secondary index. Shares the base table's partition key
 *   (do not declare `pk`); `sk` required.
 *
 * `projection` controls which attributes the index stores:
 * - `'all'` (default) — every attribute.
 * - `'keys-only'` — just the primary + index keys.
 * - `string[]` — `INCLUDE`-style list of extra attributes to project.
 *
 * `sparse` declares sparse-index-by-absence behaviour: when `true`, items
 * without the index key fields are omitted from the index. Pass
 * `{onlyWhen: (item) => boolean}` for a per-item predicate (e.g. "only
 * include rows of a certain type"). Default `false`.
 *
 * `indirect: true` declares the index as "keys-only + second-hop BatchGet":
 * the toolkit's `getListByParams` against this index reads keys, then
 * BatchGets full items from the base table. Compatible with any projection
 * but typically paired with `projection: 'keys-only'` to minimise GSI
 * storage cost.
 */
export interface IndexSpec {
  /** Discriminator — `'gsi'` or `'lsi'`. */
  type: 'gsi' | 'lsi';
  /** Partition key — required on GSI, must be omitted on LSI. */
  pk?: IndexKeySpec;
  /** Sort key — optional on GSI, required on LSI. */
  sk?: IndexKeySpec;
  /** Attribute projection — default `'all'`. */
  projection?: 'all' | 'keys-only' | string[];
  /** Sparse-index-by-absence; default `false`. */
  sparse?: boolean | {onlyWhen: (item: unknown) => boolean};
  /** Two-hop routing: reads do a BatchGet against the base table after Query/Get on the index. */
  indirect?: boolean;
}

/** Constructor options for {@link Adapter}. */
export interface AdapterOptions<TItem extends Record<string, unknown>, _TKey = Partial<TItem>> {
  /** The DynamoDB DocumentClient. Build via `DynamoDBDocumentClient.from(...)`. */
  client: DynamoDBDocumentClient;
  /** Base table name. */
  table: string;
  /**
   * Opt-in marker prefix for adapter-managed fields. When declared:
   * - Incoming user items are rejected if any field name starts with this prefix.
   * - On read, every field starting with this prefix is stripped before the
   *   user's `revive` hook sees it.
   * - Adapter-managed field names (structural key, search mirrors, version
   *   field, createdAt field) are validated at construction to start with
   *   this prefix.
   * - Built-in `prepare` / `revive` steps are wired into the hooks bag.
   *
   * Default: unset — built-in steps are no-ops and adapters behave exactly
   * as before. Convention is `'-'` when declared.
   */
  technicalPrefix?: string;
  /**
   * Partition key first, optional sort key second. Accepts either bare field
   * names (typed as `'string'`) or full {@link KeyFieldSpec} descriptors.
   * `{type: 'number'}` requires `width` in a composite (length > 1) keyFields.
   */
  keyFields: ((keyof TItem & string) | KeyFieldSpec)[];
  /**
   * Declaration of the structural (composite) key field. Required when
   * `keyFields.length > 1`. Accepts a string (shorthand for `{name}`) or a
   * full {@link StructuralKey} descriptor.
   */
  structuralKey?: string | StructuralKey;
  /**
   * Declared secondary indices (GSIs and LSIs) — single map discriminated by
   * each entry's `type`. See {@link IndexSpec}. Legacy `indirectIndices` is
   * synthesised into this map at construction with minimal metadata
   * (`{type: 'gsi', indirect: true, projection: 'keys-only'}`).
   */
  indices?: Record<string, IndexSpec>;
  /**
   * Optional type labels, paired 1:1 with `keyFields`. `typeLabels[i]` is the
   * label returned by {@link Adapter.typeOf} for a record with
   * `keyFields[0..i]` defined.
   */
  typeLabels?: string[];
  /**
   * Optional type-discriminator field. When present on an item, its value
   * overrides depth-based detection in {@link Adapter.typeOf}. Accepts a
   * string (shorthand for `{name}`) or a `{name}` descriptor.
   */
  typeDiscriminator?: string | {name: string};
  /** Alias map for projections — rewrites the first segment of each requested field. */
  projectionFieldMap?: Record<string, string>;
  /**
   * Allowlist for the `f-<field>-<op>=<value>` filter grammar. Shape
   * `{<fieldName>: [ops]}`. Requests that name an unlisted field or use
   * an op not in the allowlist are rejected with `BadFilterField` /
   * `BadFilterOp`. Type coercion for filter values comes from
   * `keyFields` / `indices` declarations (default `'string'`).
   */
  filterable?: Record<string, Array<'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in' | 'btw' | 'beg' | 'ct' | 'ex' | 'nx'>>;
  /** Fields that get a `searchablePrefix + field` lowercase mirror for substring filtering. */
  searchable?: Record<string, 1 | true>;
  /** Mirror-column prefix. Default `'-search-'`. */
  searchablePrefix?: string;
  /** GSIs that project keys only — reads do a second-hop BatchGet against the base table. */
  indirectIndices?: Record<string, 1 | true>;
  /**
   * Optional optimistic-concurrency version field. Stores a numeric
   * counter that the toolkit auto-increments on every write and auto-
   * conditions on for write-path CCF.
   *
   * - `post` initialises the field to `1` and writes with
   *   `attribute_not_exists(<pk>)`.
   * - `put(item)` reads the field from the caller's item (round-tripped
   *   from a prior read), conditions on
   *   `attribute_not_exists(<pk>) OR <versionField> = :observed`, and
   *   writes `observed + 1`. `{force: true}` bypasses the condition
   *   but still bumps the version.
   * - `patch(key, patch, {expectedVersion})` conditions when
   *   `expectedVersion` is supplied, always ADDs `+1` via
   *   UpdateExpression.
   * - `delete(key, {expectedVersion})` conditions when supplied; no
   *   increment (item is gone).
   * - `edit(key, mapFn)` / `editListByParams` auto-use the observed
   *   version from the read, condition on it, and increment.
   *
   * Must start with `technicalPrefix` (required to declare together).
   * Preserved across `revive` so callers round-trip the version through
   * read-modify-write cycles without any explicit handling.
   */
  versionField?: string;
  /**
   * Optional creation-timestamp field. When declared, mass ops accept
   * an `asOf: Date | string | number` option that scopes the scan to
   * items with `<createdAtField> <= :asOf` — the scope-freeze pattern
   * for replays, audits, and snapshot exports.
   *
   * The toolkit does NOT auto-write this field — the user's `prepare`
   * hook is responsible (e.g., `{...item, _createdAt: Date.now()}` on
   * first insert). The stored format dictates what `asOf` values to
   * pass. `Date` is auto-converted to ISO 8601 as a convenience; other
   * types pass through untouched.
   *
   * Must start with `technicalPrefix` (required to declare together).
   * Preserved across `revive`.
   */
  createdAtField?: string;
  /**
   * Parent-child relationship declaration (A6'). Gates the cascade
   * primitives ({@link Adapter.deleteAllUnder} / {@link Adapter.cloneAllUnder}
   * / {@link Adapter.moveAllUnder}) — without a declaration they throw
   * {@link CascadeNotDeclared}. The toolkit does not infer cascade scope
   * from composite `keyFields` alone.
   *
   * `{structural: true}` opts into treating the composite structural key
   * as the parent-child hierarchy. Requires composite `keyFields`
   * (length > 1) with a declared `structuralKey`.
   */
  relationships?: RelationshipsDeclaration;
  /**
   * Opt-in reserved-record descriptor key. When set, the provisioning
   * helpers (`ensureTable` / `verifyTable`) write a JSON snapshot of
   * this adapter's declaration at the reserved key and verify it on
   * subsequent runs — detecting drift beyond what `DescribeTable`
   * reports (marshalling helpers, search mirrors, `filterable`
   * allowlist, etc.).
   *
   * Default unset — IaC-managed tables ignore the descriptor entirely.
   * Typical value: `'__adapter__'`.
   */
  descriptorKey?: string;
  /** Per-instance hook overrides; merges over {@link defaultHooks}. */
  hooks?: AdapterHooks<TItem>;
}

/** Parent-child relationship declaration for the cascade primitives. */
export interface RelationshipsDeclaration {
  /**
   * Treat the composite structural key as a parent-child hierarchy.
   * Requires `keyFields.length > 1` + `structuralKey` declared.
   */
  structural?: boolean;
}

/** Options for `cloneAllUnder` — prefix-swap cascade clone. `mapFn` composes after the swap. */
export interface CloneAllUnderOptions<TItem extends Record<string, unknown>> extends MassOptions {
  /**
   * Optional per-item transform, composed after `swapPrefix(srcKey, dstKey)`
   * via `mergeMapFn`. Runs last and can override anything the swap
   * touched. Return a falsy value to skip an item.
   */
  mapFn?: (item: TItem) => TItem | null | undefined;
}

/** Options for `moveAllUnder` — prefix-swap cascade move. `mapFn` composes after the swap. */
export interface MoveAllUnderOptions<TItem extends Record<string, unknown>> extends MassOptions {
  /** See {@link CloneAllUnderOptions.mapFn}. */
  mapFn?: (item: TItem) => TItem | null | undefined;
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
  /**
   * Expected value of `versionField` for optimistic concurrency. When
   * supplied, the patch conditions on
   * `attribute_not_exists(<pk>) OR <versionField> = :expectedVersion`.
   * When omitted, no OC check is added (but the version still
   * increments if `versionField` is declared). Only meaningful when
   * `versionField` is set on the adapter.
   */
  expectedVersion?: number;
}

/** Options for `edit`. */
export interface EditOptions {
  /**
   * Projection for the initial GetItem read. When the caller knows only a
   * subset of fields matter for the diff, limiting the projection saves
   * RCU. The toolkit always re-adds any fields `prepare` touches
   * (structural key, searchable mirrors), so declaring those is optional.
   */
  readFields?: string[];
  /** Extra condition clauses on the UpdateCommand. */
  conditions?: ConditionClause[];
  /** Extra DynamoDB input merged into the Command. */
  params?: Record<string, unknown>;
  /**
   * When `true`, sets `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'`.
   */
  returnFailedItem?: boolean;
  /**
   * Skip the default `KeyFieldChanged` guard and auto-promote the edit
   * to a `move` (put-at-new-key + delete-at-old-key transaction) when
   * the mapFn diff touches any keyField.
   */
  allowKeyChange?: boolean;
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
  /**
   * Expected value of `versionField` for optimistic concurrency. When
   * supplied, the delete conditions on `<versionField> = :expectedVersion`.
   * No increment on delete (the item is gone). Only meaningful when
   * `versionField` is set on the adapter.
   */
  expectedVersion?: number;
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
  /**
   * Soft cap on items processed in this call. Page-boundary enforced —
   * the current page finishes before the cap takes effect. When reached,
   * the result includes a `cursor` so the caller can resume via
   * `resumeToken`. Only honored by list-op variants
   * (`deleteListByParams`, `cloneListByParams`, `moveListByParams`).
   */
  maxItems?: number;
  /**
   * Opaque cursor from a prior call's `MassOpResult.cursor`. Resumes at
   * the page boundary where the previous call stopped.
   */
  resumeToken?: string;
  /**
   * Write-if-absent — per-item `ConditionExpression: attribute_not_exists`.
   * Mutually exclusive with `ifExists`. Wired in 3.3.0 clone/move macros;
   * currently ignored by the bulk-batch list-op path.
   */
  ifNotExists?: boolean;
  /**
   * Write-if-present — per-item `ConditionExpression: attribute_exists`.
   * Mutually exclusive with `ifNotExists`. See note on `ifNotExists`.
   */
  ifExists?: boolean;
  /**
   * Scope-freeze upper bound for the mass-op. AND-merges
   * `<createdAtField> <= :asOf` into the `Query` / `Scan` FilterExpression,
   * restricting the op to items that existed at or before the given
   * point in time. Requires `createdAtField` to be declared on the
   * adapter — otherwise throws {@link CreatedAtFieldNotDeclared}.
   *
   * `Date` is auto-converted to ISO 8601; `string` / `number` pass
   * through (format must match what the `prepare` hook writes into
   * `createdAtField`).
   */
  asOf?: Date | string | number;
}

/** Options for list reads (`getList` / `getListByParams`). */
export interface ListOptions {
  /** Zero-based starting offset. Default `0`. */
  offset?: number;
  /** Maximum items per page. Default `10`. */
  limit?: number;
  /** Descending sort (reverses `ScanIndexForward`). */
  descending?: boolean;
  /**
   * Sort field. When set, the Adapter resolves it via
   * {@link Adapter.findIndexForSort} and picks a matching index (LSI over
   * GSI). Throws `NoIndexForSortField` when nothing matches. Ignored when
   * an explicit `index` argument is passed to `getList`, or when `useIndex`
   * is set.
   */
  sort?: string;
  /** Explicit index override — bypasses `sort` inference. */
  useIndex?: string;
  /**
   * Shortcut: project only the adapter's `keysOnlyFields` (the declared
   * `keyFields` names). Mutually exclusive with `fields` — when both are
   * set, `keysOnly` wins. Programmatic equivalent of the `?fields=*keys`
   * wire wildcard.
   */
  keysOnly?: boolean;
  /** Strong consistency. */
  consistent?: boolean;
  /** Field spec for projection. */
  fields?: string | string[] | null;
  /** Substring filter over `searchable` fields. */
  filter?: string;
  /**
   * Parsed `f-<field>-<op>=<value>` clauses (from the REST layer's
   * `parseFFilter`). Compiled by `adapter.applyFFilter` into
   * `FilterExpression` / `KeyConditionExpression`.
   */
  fFilter?: Array<{field: string; op: string; values: string[]}>;
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
  /** Opt-in adapter-managed-field prefix, when declared. */
  technicalPrefix?: string;
  /**
   * DB primary-key attribute names — computed at construction. With
   * `structuralKey` declared, equals `[keyFields[0].name, structuralKey.name]`
   * (partition + sort). Without, equals the single-element list of the lone
   * keyField's name. Used internally by `_restrictKey` and mass-op
   * projections that need to extract primary keys from scanned items.
   */
  primaryKeyAttrs: string[];
  /**
   * Canonical typed descriptors — partition key first, optional sort key
   * second. Always normalized to `{field, type}` (plus `width` when present
   * on `{type: 'number'}` composites). Bare-string inputs to the
   * constructor are normalized into this shape. Read a single field name
   * with `keyFields[i].name`; get a string-names array with
   * `keyFields.map(f => f.name)` when that's needed.
   */
  keyFields: Required<KeyFieldSpec>[];
  /** Structural-key declaration (only set when `keyFields.length > 1` or explicitly declared). */
  structuralKey?: Required<StructuralKey>;
  /** Type labels paired 1:1 with `keyFields`, when declared. */
  typeLabels?: string[];
  /** Type-discriminator field config, when declared. */
  typeDiscriminator?: {name: string};
  /** Alias map for projections. */
  projectionFieldMap: Record<string, string>;
  /** Searchable-field map for substring filtering. */
  searchable: Record<string, 1 | true>;
  /** Allowlist for the `f-<field>-<op>=<value>` filter grammar. */
  filterable: Record<string, string[]>;
  /** Mirror-column prefix. Default `'-search-'`. */
  searchablePrefix: string;
  /** Indirect-index map — reads against these GSIs do a second-hop BatchGet. */
  indirectIndices: Record<string, 1 | true>;
  /**
   * Normalised secondary-index map. Populated from `options.indices`, plus
   * legacy `indirectIndices` entries synthesised into minimal GSI shapes.
   */
  indices: Record<string, Required<Omit<IndexSpec, 'pk' | 'sk'>> & {pk?: IndexKeySpec; sk?: IndexKeySpec}>;
  /** Resolved hooks bag (defaults merged with user overrides). */
  hooks: Required<AdapterHooks<TItem>>;

  /**
   * Return the type label for an item. Priority:
   *   1. `typeDiscriminator.name` value when present on the item (coerced to string).
   *   2. `typeLabels[depth - 1]` where `depth` = count of contiguous-from-start
   *      defined `keyFields` on the item, when `typeLabels` is declared.
   *   3. Raw `depth` number when no `typeLabels` is declared.
   *
   * Returns `undefined` when the item has no recognised type-signalling
   * fields at all (empty item, no discriminator, no keyFields present).
   *
   * @param item The item to classify.
   */
  typeOf(item: Partial<TItem> | undefined | null): string | number | undefined;

  /**
   * Find the declared secondary index whose sort key (`sk.name`) matches
   * the requested sort field. Prefers LSI over GSI when both match.
   * Throws `NoIndexForSortField` when no declared index matches — the
   * toolkit does not in-memory-sort.
   *
   * @param field Sort field name.
   * @returns The name of the matching index.
   * @throws NoIndexForSortField when nothing matches.
   */
  findIndexForSort(field: string): string;

  /**
   * Compile parsed `f-<field>-<op>=<value>` clauses into `params`.
   * Validates against `filterable`, coerces values to declared types,
   * auto-promotes index-compatible clauses to `KeyConditionExpression`;
   * rest land in `FilterExpression`. Mutates and returns `params`.
   *
   * @throws BadFilterField when a clause names a field not in `filterable`.
   * @throws BadFilterOp when the op isn't allowlisted for that field.
   */
  applyFFilter(params: Record<string, unknown>, clauses: Array<{field: string; op: string; values: string[]}>): Record<string, unknown>;

  /**
   * Build a `KeyConditionExpression` for a Query against this Adapter's main
   * table. Ergonomic surface over {@link buildKeyCondition} — the Adapter
   * uses its declared `keyFields` / `structuralKey` to validate `values` and
   * join them into the right prefix.
   *
   * `values` is keyed by `keyFields` names and must be
   * **contiguous-from-start** (no gaps — if `rentalName` is missing, `carVin`
   * must also be missing). At least the partition keyField is required.
   *
   * `options.kind` controls the match shape:
   * - `'exact'` (default) — equality match: `structuralKey = "TX|Dallas"`.
   * - `'children'` — `begins_with(structuralKey, "TX|Dallas|")`, trailing
   *   separator included so the parent record isn't matched.
   * - `'partial'` — `begins_with(structuralKey, "TX|Dallas|Bui")`; requires
   *   `options.partial` as the suffix after the separator.
   *
   * Inference: `'exact'` when no `partial`; `'partial'` when `partial`
   * is present; `'children'` must be explicit.
   *
   * Composite `keyFields` require a `structuralKey` declaration.
   * Single-field `keyFields` only support `kind: 'exact'`.
   *
   * @param values Object keyed by `keyFields` names; contiguous-from-start.
   * @param options `{kind?, partial?, indexName?}`.
   * @param params Optional existing params to merge into.
   * @returns The same `params` with `KeyConditionExpression` set and
   *   `ExpressionAttributeNames` / `ExpressionAttributeValues` extended.
   */
  buildKey(
    values: Partial<TItem>,
    options?: {kind?: 'exact' | 'children' | 'partial'; partial?: string; indexName?: string},
    params?: Record<string, unknown>
  ): Record<string, unknown>;

  /**
   * Build a mapFn that swaps a leading `keyFields` prefix. Given
   * `srcPrefix = {state: 'TX'}` and `dstPrefix = {state: 'FL'}`, the returned
   * function rewrites each item's `state` field from `'TX'` to `'FL'`, leaving
   * all other `keyFields` and non-key data intact.
   *
   * Prefixes must be **contiguous-from-start** (both start at the partition
   * keyField) and name the **same** keyFields. Throws at construction when
   * those invariants are violated. Throws at apply time when an item's
   * value doesn't actually match `srcPrefix` — usually a sign that the
   * upstream query wasn't scoped to the src subtree.
   *
   * Typical use: subtree clone / move between prefixes.
   * `adapter.cloneListByParams(params, adapter.swapPrefix({state: 'TX'}, {state: 'FL'}))`.
   *
   * @param srcPrefix Source keyField prefix.
   * @param dstPrefix Destination keyField prefix (same keys as src).
   * @returns A mapFn that rewrites the leading prefix on each item.
   */
  swapPrefix(srcPrefix: Partial<TItem>, dstPrefix: Partial<TItem>): (item: TItem) => TItem;

  /**
   * Build a mapFn that merges a static overlay object into each item
   * (`{...item, ...overlay}`). `overlay`'s values win. If `overlay` touches
   * a keyField, the destination structural key shifts accordingly.
   *
   * Validates that `overlay` doesn't set any keyField to `undefined` or
   * `null` — that would break destination-key formation. Non-keyField
   * entries in `overlay` are unrestricted.
   *
   * Typical use: bulk-tag records during clone
   * (`adapter.overlayFields({archived: true})`).
   *
   * @param overlay Static object merged into each item.
   * @returns A mapFn that applies the overlay.
   */
  overlayFields(overlay: Partial<TItem> & Record<string, unknown>): (item: TItem) => TItem;

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
  getList(options?: ListOptions, example?: Partial<TItem>, index?: string): Promise<PaginatedResult<TItem>>;

  /**
   * Paginated list from caller-built DynamoDB params. Skips the
   * `prepareListInput` hook.
   *
   * @param params Pre-built DynamoDB `Query` / `Scan` input.
   * @param options Paging / sorting / revive options.
   * @returns Same envelope shape as {@link Adapter.getList} — a single page of items plus
   *   `offset`/`limit`/optional `total`.
   */
  getListByParams(params: Record<string, unknown>, options?: ListOptions): Promise<PaginatedResult<TItem>>;

  /** @deprecated Use {@link Adapter.getList}. Removed in a future minor. */
  getAll(options?: ListOptions, example?: Partial<TItem>, index?: string): Promise<PaginatedResult<TItem>>;
  /** @deprecated Use {@link Adapter.getListByParams}. Removed in a future minor. */
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
   * Read → transform → shallow-diff → UpdateItem. `mapFn(revived)`
   * returns the new full item; the toolkit emits SET / REMOVE clauses
   * only for fields that actually changed. Returns the revived new item
   * on success, or `undefined` when the source item is absent or the
   * `mapFn` returns falsy.
   *
   * When the diff touches any declared `keyFields`, throws
   * {@link KeyFieldChanged} unless `{allowKeyChange: true}` is set, in
   * which case the edit auto-promotes to a `move`
   * (put-at-new-key + delete-at-old-key transaction).
   */
  edit(key: TKey | Raw<TKey>, mapFn: (item: TItem) => TItem, options?: EditOptions): Promise<TItem | undefined>;

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
  putItems(items: (TItem | Raw<TItem>)[], options?: MassOptions): Promise<{processed: number}>;
  /**
   * Bulk delete by known keys.
   *
   * @param keys Keys to delete.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — total delete actions DynamoDB accepted (missing items count too).
   */
  deleteByKeys(keys: (TKey | Raw<TKey>)[], options?: MassOptions): Promise<{processed: number}>;
  /**
   * Delete every item matching `params` (Query / Scan). Resumable via
   * `options.maxItems` + `options.resumeToken` — when `maxItems` is
   * reached at a page boundary, the result carries a `cursor` for
   * continuation. Re-delete of already-absent items is idempotent; safe
   * to retry.
   *
   * @param params Pre-built DynamoDB `Query` / `Scan` input.
   * @param options Resumable mass-op options.
   * @returns `MassOpResult` — `processed` counts delete actions accepted;
   *   `cursor` present when stopped by `maxItems`.
   */
  deleteListByParams(params: Record<string, unknown>, options?: MassOptions): Promise<MassOpResult>;
  /**
   * Clone each item identified by a key, optionally transformed by `mapFn`.
   *
   * @param keys Source keys.
   * @param mapFn Transform applied before writing the copy. Default identity.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — total copies written.
   */
  cloneByKeys(keys: (TKey | Raw<TKey>)[], mapFn: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  /**
   * Clone every item matching `params`, optionally transformed by `mapFn`.
   * Resumable via `options.maxItems` + `options.resumeToken`. `mapFn`
   * returning a falsy value drops that item silently (not counted as a
   * failure).
   *
   * @param params Pre-built `Query` / `Scan` input.
   * @param mapFn Transform applied before writing the copy. Default identity.
   * @param options Resumable mass-op options.
   * @returns `MassOpResult` — `processed` counts copies written;
   *   `cursor` present when stopped by `maxItems`.
   */
  cloneListByParams(params: Record<string, unknown>, mapFn: (item: TItem) => TItem, options?: MassOptions): Promise<MassOpResult>;
  /**
   * Move each item identified by a key (paired put + delete chunks).
   *
   * @param keys Source keys.
   * @param mapFn Transform applied before writing the destination. Default identity.
   * @param options Strategy / extra DynamoDB input.
   * @returns `{processed}` — sum of put + delete actions (≈ 2× the moved-item count on success).
   */
  moveByKeys(keys: (TKey | Raw<TKey>)[], mapFn: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  /**
   * Move every item matching `params` (paired put + delete chunks).
   * Resumable via `options.maxItems` + `options.resumeToken`. `mapFn`
   * returning a falsy value drops both legs (the source is NOT deleted
   * when its destination copy is not written).
   *
   * @param params Pre-built `Query` / `Scan` input.
   * @param mapFn Transform applied before writing the destination. Default identity.
   * @param options Resumable mass-op options.
   * @returns `MassOpResult` — `processed` is the sum of put + delete actions
   *   (≈ 2× the moved-item count on success); `cursor` present when stopped by `maxItems`.
   */
  moveListByParams(params: Record<string, unknown>, mapFn: (item: TItem) => TItem, options?: MassOptions): Promise<MassOpResult>;
  /**
   * Resumable per-item edit across a `Query` / `Scan` scope. For each
   * item in the scan, runs `mapFn(revived)` → shallow-diff → emit
   * `UpdateCommand`. Unchanged items are counted as `skipped` (no WCU
   * spent); `mapFn` returning a falsy value also buckets to `skipped`.
   *
   * When the diff touches any declared `keyFields`:
   *   - Default: the item is bucketed into `failed` with a descriptive
   *     message (edit is for non-key fields only; mass-edit does not
   *     throw `KeyFieldChanged` because one bad item shouldn't halt the
   *     whole run).
   *   - `{allowKeyChange: true}`: auto-promotes that item to a `move`
   *     (put-at-new-key + delete-at-old-key transaction).
   *
   * Items that vanish between the scan and the update (race with
   * another writer) are bucketed into `skipped` via the
   * `ConditionalCheckFailed` on the existence guard.
   */
  editListByParams(params: Record<string, unknown>, mapFn: (item: TItem) => TItem, options?: MassOptions & EditOptions): Promise<MassOpResult>;
  /**
   * Subtree rename macro: put every item from the `fromExample` scope
   * to the `toExample` scope, then delete the source. Constructive
   * before destructive — crash mid-phase leaves the source intact,
   * resume completes the delete; crash mid-item's put is safely
   * reattempted (CCF on already-written item → `skipped`).
   *
   * Non-transactional. The destination key is derived per-item via
   * `swapPrefix(fromExample, toExample)`; pass `options.mapFn` to
   * compose additional transforms on non-key fields.
   *
   * `options.kind` selects the source scope shape: defaults to
   * `'children'` (subtree rename), set `'exact'` for a leaf. Resumable
   * via `options.maxItems` + `options.resumeToken`. Put-collisions
   * (destination already exists) bucket into `skipped`.
   */
  rename(
    fromExample: Partial<TItem>,
    toExample: Partial<TItem>,
    options?: MassOptions & {mapFn?: (item: TItem) => TItem; kind?: 'exact' | 'children'}
  ): Promise<MassOpResult>;
  /**
   * Subtree clone-with-overwrite macro: delete each item at the
   * destination (idempotent — absent is fine), then put the new
   * content. Destructive before constructive — caller asserts they
   * want the destination cleared. Source stays intact (clone, not
   * move).
   *
   * Non-transactional. Destination keys derived via
   * `swapPrefix(fromExample, toExample)`; pass `options.mapFn` to
   * compose additional transforms.
   *
   * Crash mid-phase on the delete is safe (dst was destined for
   * destruction anyway); crash mid-phase on the put leaves dst empty
   * but a resume writes it. `options.kind` selects scope shape;
   * resumable via `options.maxItems` + `options.resumeToken`.
   */
  cloneWithOverwrite(
    fromExample: Partial<TItem>,
    toExample: Partial<TItem>,
    options?: MassOptions & {mapFn?: (item: TItem) => TItem; kind?: 'exact' | 'children'}
  ): Promise<MassOpResult>;

  /**
   * Cascade subtree delete: delete the self node at `srcKey` and every
   * descendant declared to hang off it. Leaf-first — descendants are
   * removed via `deleteListByParams(buildKey(srcKey, {kind: 'children'}))`
   * before the self node is deleted.
   *
   * Requires `options.relationships.structural` on the adapter; throws
   * {@link CascadeNotDeclared} otherwise.
   *
   * Resumable via `options.maxItems` + `options.resumeToken` on the
   * descendants phase. The self-delete runs only when pagination
   * completes (no `cursor` in the descendants result); intermediate
   * returns surface the cursor so the caller can resume.
   */
  deleteAllUnder(srcKey: Partial<TItem>, options?: MassOptions): Promise<MassOpResult>;
  /**
   * Cascade subtree clone — prefix-swap flavour: copy the self node at
   * `srcKey` plus every descendant to a `dstKey` subtree via
   * `swapPrefix(srcKey, dstKey)`. Root-first — self node written before
   * descendants. Source stays intact.
   *
   * Requires `options.relationships.structural` on the adapter; throws
   * {@link CascadeNotDeclared} otherwise.
   *
   * `options.mapFn` composes after the prefix swap (same pattern as
   * {@link Adapter.rename}); use {@link Adapter.cloneAllUnderBy} when
   * the destination is not a uniform subtree.
   *
   * `ifNotExists` / `ifExists` route the per-item write through the
   * conditional put path. Resumable via `maxItems` + `resumeToken` on
   * the descendants phase; the self-clone runs only on the first call.
   */
  cloneAllUnder(srcKey: Partial<TItem>, dstKey: Partial<TItem>, options?: CloneAllUnderOptions<TItem>): Promise<MassOpResult>;
  /**
   * Cascade subtree clone — `mapFn`-driven flavour: the caller's `mapFn`
   * wholly determines per-item destinations. Useful for fan-out across
   * different subtrees based on item properties.
   *
   * Same root-first semantics and declaration gate as
   * {@link Adapter.cloneAllUnder}; no `dstKey` concept.
   */
  cloneAllUnderBy(srcKey: Partial<TItem>, mapFn: (item: TItem) => TItem | null | undefined, options?: MassOptions): Promise<MassOpResult>;
  /**
   * Cascade subtree move — prefix-swap flavour: copy-then-delete the
   * self node at `srcKey` plus every descendant to a `dstKey` subtree
   * via `swapPrefix(srcKey, dstKey)`. Leaf-first — descendants migrate
   * first, self node last. Two-phase idempotent pattern shared with
   * {@link Adapter.rename}.
   *
   * Requires `options.relationships.structural` on the adapter; throws
   * {@link CascadeNotDeclared} otherwise.
   *
   * `options.mapFn` composes after the prefix swap. Resumable via
   * `maxItems` + `resumeToken` on the descendants phase; the self-move
   * runs only when pagination completes.
   */
  moveAllUnder(srcKey: Partial<TItem>, dstKey: Partial<TItem>, options?: MoveAllUnderOptions<TItem>): Promise<MassOpResult>;
  /**
   * Cascade subtree move — `mapFn`-driven flavour: destinations as
   * `mapFn` dictates. Same leaf-first semantics and declaration gate as
   * {@link Adapter.moveAllUnder}; no `dstKey` concept.
   */
  moveAllUnderBy(srcKey: Partial<TItem>, mapFn: (item: TItem) => TItem | null | undefined, options?: MassOptions): Promise<MassOpResult>;

  /** @deprecated Use {@link Adapter.putItems}. Removed in a future minor. */
  putAll(items: (TItem | Raw<TItem>)[], options?: MassOptions): Promise<{processed: number}>;
  /** @deprecated Use {@link Adapter.deleteListByParams}. Removed in a future minor. */
  deleteAllByParams(params: Record<string, unknown>, options?: MassOptions): Promise<MassOpResult>;
  /** @deprecated Use {@link Adapter.cloneListByParams}. Removed in a future minor. */
  cloneAllByParams(params: Record<string, unknown>, mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<MassOpResult>;
  /** @deprecated Use {@link Adapter.moveListByParams}. Removed in a future minor. */
  moveAllByParams(params: Record<string, unknown>, mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<MassOpResult>;

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
