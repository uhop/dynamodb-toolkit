export interface ResolvedSort {
  /** Index name looked up from `sortableIndices`; `undefined` when no sort was requested. */
  index: string | undefined;
  /** `true` when the sort value was prefixed with `-`. */
  descending: boolean;
}

/**
 * Resolve a `?sort=…` query value to a `{index, descending}` pair using a
 * sortable-indices map. Throws `NoIndexForSortField` when a sort is
 * requested but no index is mapped for that field — the toolkit refuses
 * rather than in-memory-sorting.
 *
 * @param query String-coerced query map.
 * @param sortableIndices `{fieldName: indexName}` mapping.
 * @returns `{index, descending}`. `index` is `undefined` only when no
 *   sort was requested.
 * @throws NoIndexForSortField when a sort field is present but unmapped.
 */
export function resolveSort(query: Record<string, string>, sortableIndices?: Record<string, string>): ResolvedSort;
