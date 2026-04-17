/** A single atomic array/set operation for `UpdateExpression`. */
export interface ArrayOp {
  /**
   * Kind of array operation.
   * - `append` / `prepend` — add element(s) to tail / head via `list_append`
   * - `setAtIndex` — absolute-index assignment
   * - `removeAtIndex` — absolute-index REMOVE (leaves a hole; no shift)
   * - `add` — atomic numeric increment or Set add
   */
  op: 'append' | 'prepend' | 'setAtIndex' | 'removeAtIndex' | 'add';
  /** Dotted path to the target attribute. */
  path: string;
  /** Required for `append` / `prepend` — elements to add. */
  values?: unknown[];
  /** Required for `setAtIndex` / `add` — single value to assign / add. */
  value?: unknown;
  /** Required for `setAtIndex` / `removeAtIndex` — the absolute array index. */
  index?: number;
}

/** Options for {@link buildUpdate}. */
export interface UpdateOptions {
  /** Paths to REMOVE from the item. */
  delete?: string[];
  /** Path separator. Default `'.'`. Pure-digit segments become array indices. */
  separator?: string;
  /** Atomic array / Set operations to include in the same UpdateExpression. */
  arrayOps?: ArrayOp[];
}

/**
 * Build a DynamoDB `UpdateExpression` from a patch object and options. Handles
 * attribute-name aliasing (`#upk0`, `#upk1`, …), attribute-value placeholders
 * (`:upv0`, `:upv1`, …), and preserves any existing `ExpressionAttributeNames`
 * / `ExpressionAttributeValues` in `params`. Mutates and returns `params`.
 *
 * @param patch Flat object — keys are dotted paths, values are what to SET.
 * @param options Deletion paths, path separator, and array ops.
 * @param params Existing DynamoDB params to extend. A fresh object is used when omitted.
 */
export function buildUpdate<T extends Record<string, unknown>>(
  patch: Record<string, unknown>,
  options?: UpdateOptions,
  params?: T
): T & {UpdateExpression: string};
