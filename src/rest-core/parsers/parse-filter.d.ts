/** Options for {@link parseFilter}. */
export interface ParseFilterOptions {
  /** Match mode. Passed through to the returned object. */
  mode?: 'substring' | 'prefix' | 'exact' | 'tokenized';
  /** Case sensitivity. Passed through. */
  caseSensitive?: boolean;
}

/** Return shape of {@link parseFilter}. */
export interface ParsedFilter {
  /** The query string. */
  query: string;
  /** Match mode, if supplied in options. */
  mode?: 'substring' | 'prefix' | 'exact' | 'tokenized';
  /** Case sensitivity, if supplied in options. */
  caseSensitive?: boolean;
}

/**
 * Parse a `?filter=` query value. Returns `null` when missing / empty /
 * whitespace-only.
 *
 * @param input Raw query value.
 * @param options Optional mode + case-sensitivity passed through to the result.
 * @returns `{query, mode?, caseSensitive?}` — ready to hand to `buildFilter` — or `null`
 *   when no filter was requested.
 */
export function parseFilter(input: string | string[] | null | undefined, options?: ParseFilterOptions): ParsedFilter | null;
