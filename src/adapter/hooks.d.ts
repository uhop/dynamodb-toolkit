import type {BatchDescriptor} from './adapter.js';

/** Single-op name passed to the `updateInput` hook. */
export type OpName = 'post' | 'put' | 'patch' | 'delete';

/**
 * User-supplied Adapter hooks. Pass via `AdapterOptions.hooks` or override
 * on a subclass. Every hook is optional; defaults are in {@link defaultHooks}.
 */
export interface AdapterHooks<TItem extends Record<string, unknown>> {
  /**
   * Transform an item before writing. Add technical fields (search mirrors,
   * derived columns, tenant IDs), strip transient fields. `isPatch` is `true`
   * when invoked from `patch` / `makePatch`.
   */
  prepare?: (item: TItem, isPatch?: boolean) => TItem;
  /**
   * Shape a key for a single-item operation. Default restricts to `keyFields`.
   * Override when key construction depends on the index.
   */
  prepareKey?: (key: Partial<TItem>, index?: string) => Partial<TItem>;
  /**
   * Build extra DynamoDB input for list / scan / query operations (e.g.
   * `IndexName`, `KeyConditionExpression`).
   */
  prepareListInput?: (example: Partial<TItem>, index?: string) => Record<string, unknown>;
  /**
   * Last-chance hook to mutate a Command input before dispatch. `op.name` is
   * the single-op name; `op.force` is `true` on forced puts.
   */
  updateInput?: (input: Record<string, unknown>, op: {name: OpName; force?: boolean}) => Record<string, unknown>;
  /**
   * Transform an item after reading — strip technical fields, apply field
   * subsetting, rebuild calculated fields. Default applies `subsetObject`
   * when `fields` is supplied.
   */
  revive?: (rawItem: TItem, fields?: string[]) => TItem;
  /** Async validator. Throw to abort the write. */
  validateItem?: (item: TItem, isPatch?: boolean) => Promise<void>;
  /**
   * Return extra `make*` descriptors to bundle in the same
   * `TransactWriteItems` as the main op. Returning `null` dispatches as a
   * single op; returning any array (including `[]`) triggers a transaction.
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
 */
export function restrictKey<T extends Record<string, unknown>>(rawKey: T, keyFields: string[]): Partial<T>;
