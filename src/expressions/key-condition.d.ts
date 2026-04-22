/**
 * Input for `buildKeyCondition` — describes one Query's KeyCondition.
 * `field` + `value` name the sort/structural key and its already-prepared
 * query value; `kind` picks `=` or `begins_with`; `pkField` / `pkValue`
 * optionally add the partition-key equality clause.
 */
export interface KeyConditionInput {
  /** Field name of the sort or structural key (e.g. `'-sk'`). */
  field: string;
  /** Fully-prepared value — caller joins keyFields components if using a structural key. */
  value: string;
  /** `'exact'` → `field = :v`; `'prefix'` → `begins_with(field, :v)`. */
  kind: 'exact' | 'prefix';
  /** Partition-key field name (optional). When set, adds `pkField = :pk` to the clause. */
  pkField?: string;
  /** Partition-key value (required when `pkField` is set). */
  pkValue?: unknown;
}

/**
 * Build a `KeyConditionExpression` clause for a DynamoDB Query. Adapter-agnostic
 * primitive — accepts a fully-prepared value string; the caller is responsible
 * for joining `keyFields` values into the right shape. See
 * `adapter.buildKey()` for the ergonomic surface that uses the Adapter's
 * declared `keyFields` / `structuralKey` to build the prefix automatically.
 *
 * Merges into `params` with counter-based placeholders (`#kc<n>` /
 * `:kcv<n>`), AND-combined with any existing `KeyConditionExpression`.
 * Follows the same pattern as `buildCondition` / `addProjection`.
 *
 * @param input Key-condition description.
 * @param params Optional existing params to merge into.
 * @returns The same `params` object with `KeyConditionExpression` set and
 *   `ExpressionAttributeNames` / `ExpressionAttributeValues` extended.
 */
export function buildKeyCondition(input: KeyConditionInput, params?: Record<string, unknown>): Record<string, unknown>;
