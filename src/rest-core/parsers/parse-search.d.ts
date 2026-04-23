/** Options for {@link parseSearch}. */
export interface ParseSearchOptions {
  /** Match mode. Passed through to the returned object. */
  mode?: 'substring' | 'prefix' | 'exact' | 'tokenized';
  /** Case sensitivity. Passed through. */
  caseSensitive?: boolean;
  /** Maximum query-string length; longer inputs are truncated. Default `1024`. */
  maxLength?: number;
}

/** Return shape of {@link parseSearch}. */
export interface ParsedSearch {
  /** The query string. */
  query: string;
  /** Match mode, if supplied in options. */
  mode?: 'substring' | 'prefix' | 'exact' | 'tokenized';
  /** Case sensitivity, if supplied in options. */
  caseSensitive?: boolean;
}

/**
 * Parse a `?search=` query value. Returns `null` when missing / empty /
 * whitespace-only.
 *
 * @param input Raw query value.
 * @param options Optional mode + case-sensitivity passed through to the result.
 * @returns `{query, mode?, caseSensitive?}` — ready to hand to `buildSearch` — or `null`
 *   when no search was requested.
 */
export function parseSearch(input: string | string[] | null | undefined, options?: ParseSearchOptions): ParsedSearch | null;
