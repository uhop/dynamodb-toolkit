export interface ResolvedSort {
  /** GSI name looked up from `sortableIndices`; `undefined` when no sort is set or the field isn't mapped. */
  index: string | undefined;
  /** `true` when the sort value was prefixed with `-`. */
  descending: boolean;
}

/**
 * Resolve a `?sort=…` query value to a `{index, descending}` pair using a
 * field→GSI-name mapping.
 *
 * @param query String-coerced query map.
 * @param sortableIndices `{fieldName: gsiName}` mapping. Missing entries
 *   resolve to `index: undefined`.
 */
export function resolveSort(query: Record<string, string>, sortableIndices?: Record<string, string>): ResolvedSort;
