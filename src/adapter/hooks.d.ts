import type {BatchDescriptor} from './adapter.js';

/** Single-op name passed to the `updateInput` hook. */
export type OpName = 'post' | 'put' | 'patch' | 'delete';

/**
 * User-supplied Adapter hooks. Pass via `AdapterOptions.hooks` or override
 * on a subclass. Every hook is optional; defaults are in {@link defaultHooks}.
 */
export interface AdapterHooks<TItem extends Record<string, unknown>> {
  /**
   * Transform an item on the way to DynamoDB. Typical uses: add searchable
   * mirror columns, add author-convention technical fields, strip transient
   * fields, rename attributes.
   *
   * Called by every non-`Raw` write: `post`, `put`, `patch`, `putAll`,
   * `cloneByKeys`, `cloneAllByParams`, `moveByKeys`, `moveAllByParams`.
   *
   * - `item` — the caller-supplied item (or the pre-existing item after a
   *   `clone` / `move` read). Safe to mutate; also safe to return a fresh
   *   object.
   * - `isPatch` — `true` when invoked from `patch` / `makePatch` (partial
   *   update). Use it to skip fields that must not move on a partial update.
   *
   * Return the DB-side shape of the item. Return value is fed to the
   * `BatchDescriptor.params.Item` / `UpdateCommand` input.
   */
  prepare?: (item: TItem, isPatch?: boolean) => TItem;
  /**
   * Shape a caller-supplied key into the DynamoDB `Key` object.
   *
   * Called on every keyed op: `getByKey`, `getByKeys`, `patch`, `delete`,
   * `makeGet`, `makeCheck`, `makePatch`, `makeDelete`, `clone`, `move`.
   *
   * - `key` — caller-supplied key (may carry extra fields — they'll be
   *   stripped by the default impl).
   * - `index` — current `IndexName` when the call targets a GSI; `undefined`
   *   for base-table ops.
   *
   * Return a key object whose fields match the table (or GSI) key schema.
   * The Adapter restricts the result to `keyFields` after this hook runs.
   */
  prepareKey?: (key: Partial<TItem>, index?: string) => Partial<TItem>;
  /**
   * Produce extra DynamoDB input for `getAll`. Typical use: supply
   * `IndexName` + `KeyConditionExpression` so a `Scan` becomes a `Query`.
   *
   * Called once per `getAll` — right at the start of list-params
   * construction. The default implementation returns `{}` (plain scan).
   *
   * - `example` — the `example` argument `getAll` was called with (often a
   *   partial item that the hook maps to index-key values).
   * - `index` — the `index` argument `getAll` was called with (a GSI name,
   *   or `undefined`).
   *
   * Return a plain object — its fields are shallow-merged into the
   * `QueryCommand` / `ScanCommand` input before the caller's paging /
   * filter / projection options are layered on top.
   */
  prepareListInput?: (example: Partial<TItem>, index?: string) => Record<string, unknown>;
  /**
   * Last-chance hook to mutate a Command's input before it's handed to the
   * SDK. Runs after `buildUpdate` / `buildCondition` / existence checks but
   * before `cleanParams`, so any name/value aliases you add are kept.
   *
   * Called on every single write: `post`, `put`, `patch`, `delete` (and
   * their `make*` batch-builder counterparts).
   *
   * - `input` — the fully-built `params` object. Typically mutated in place.
   * - `op.name` — which CRUD surface called the hook: `'post' | 'put' |
   *   'patch' | 'delete'`.
   * - `op.force` — `true` on forced puts (`put(item, {force: true})`);
   *   `undefined` otherwise.
   *
   * Return the input (either the same reference mutated, or a new object).
   * The return value is what gets dispatched.
   */
  updateInput?: (input: Record<string, unknown>, op: {name: OpName; force?: boolean}) => Record<string, unknown>;
  /**
   * Transform an item on the way back from DynamoDB to the client shape.
   * Typical use: strip mirror columns and technical fields, recover Sets,
   * reshape nested structures.
   *
   * Called on every read (unless `{reviveItems: false}` was passed, in
   * which case the Adapter returns a `Raw<T>` instead).
   *
   * - `rawItem` — the item as DynamoDB returned it.
   * - `fields` — the projection spec the caller requested (passed through
   *   from `getByKey` / `getAllByParams` / etc.). The default
   *   implementation applies `subsetObject(rawItem, fields)` when this is
   *   set.
   *
   * Return the client-shape item. Return value is what CRUD reads resolve
   * to and what populates `PaginatedResult.data`.
   */
  revive?: (rawItem: TItem, fields?: string[]) => TItem;
  /**
   * Async validator. Throw (or reject) to abort the write before it hits
   * DynamoDB.
   *
   * Called on every non-`Raw` write: `post`, `put`, `patch`, `putAll`
   * (per-item), and the `make*` builders.
   *
   * - `item` — the item to validate.
   * - `isPatch` — `true` when called from `patch` / `makePatch` (partial
   *   updates may only need partial validation).
   *
   * Return `Promise<void>`. Reject with a meaningful Error; the Adapter
   * propagates it to the caller.
   */
  validateItem?: (item: TItem, isPatch?: boolean) => Promise<void>;
  /**
   * Return extra `make*` descriptors to bundle in the same
   * `TransactWriteItems` as the main op. Triggers the Adapter's
   * transaction auto-upgrade path — see `Adapter:-Transaction-auto-upgrade`
   * in the wiki.
   *
   * Called on every single write (`post`, `put`, `patch`, `delete`) after
   * the matching `make*` builder has produced the main descriptor.
   *
   * - `batch` — the just-built `{action, params}` main descriptor the
   *   Adapter was about to dispatch. Inspect `batch.action` and
   *   `batch.params.Item` / `batch.params.Key` to decide whether any
   *   consistency checks apply.
   *
   * Return `null` to dispatch the main op as a single Command (fast path).
   * Return any array — including `[]` — to bundle into a
   * `TransactWriteItems` call (the main op plus every returned descriptor).
   * The combined action count must stay ≤ `TRANSACTION_LIMIT` (100);
   * otherwise the Adapter throws `TransactionLimitExceededError`.
   */
  checkConsistency?: (batch: BatchDescriptor) => Promise<BatchDescriptor[] | null>;
}

/**
 * Default identity-shaped hooks used when the user doesn't override. The
 * `revive` default applies `subsetObject(rawItem, fields)` when fields is
 * supplied; all other hooks are pass-through.
 */
export const defaultHooks: Required<AdapterHooks<Record<string, unknown>>>;

/**
 * Return a key-only object containing just the fields listed in `keyFields`.
 *
 * @param rawKey Source key (may carry extra fields).
 * @param keyFields Names of the partition (and optional sort) key fields.
 * @returns A fresh object containing only the listed key fields — safe to use as a
 *   DynamoDB `Key` without dragging projection fields into the request.
 */
export function restrictKey<T extends Record<string, unknown>>(rawKey: T, keyFields: string[]): Partial<T>;
