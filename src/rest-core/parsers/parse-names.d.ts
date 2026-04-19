/** Options for {@link parseNames}. */
export interface ParseNamesOptions {
  /** Maximum number of names to keep; extras are truncated. Default `1000`. */
  maxItems?: number;
}

/**
 * Parse a `?names=` query value or JSON body. Accepts a comma-separated
 * string or an array. Returns `[]` on missing/empty input. Output is capped
 * at `options.maxItems` (default 1000) to prevent DoS via unbounded key counts.
 *
 * @param input Raw value.
 * @param options Optional cap override.
 * @returns A list of trimmed names in input order — empty array (never `null`) when
 *   nothing was supplied, so callers can iterate unconditionally.
 */
export function parseNames(input: string | string[] | null | undefined, options?: ParseNamesOptions): string[];
