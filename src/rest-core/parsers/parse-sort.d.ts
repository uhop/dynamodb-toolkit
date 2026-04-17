/** One field + direction. */
export interface SortClause {
  /** Field name. */
  field: string;
  /** Sort direction. */
  direction: 'asc' | 'desc';
}

/** Return shape of {@link parseSort}. */
export interface ParsedSort extends SortClause {
  /** All parsed clauses in input order — useful for multi-key sort. */
  chain: SortClause[];
}

/**
 * Parse a `?sort=` query value. A leading `-` on a field name marks descending
 * order (`-name` → `{field: 'name', direction: 'desc'}`). Multi-field input
 * like `'name,-other'` fills `chain`; the top-level `field`/`direction`
 * mirror the first clause. Returns `null` when the input is missing or empty.
 *
 * @param input Raw query value.
 */
export function parseSort(input: string | string[] | null | undefined): ParsedSort | null;
