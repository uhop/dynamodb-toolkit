/** Options for {@link parseFields}. */
export interface ParseFieldsOptions {
  /** Maximum number of field paths to keep; extras are truncated. Default `1000`. */
  maxItems?: number;
}

/**
 * Parse a `?fields=` query value. Accepts a comma-separated string or array.
 * Returns `null` when the input is missing or empty (caller should not apply
 * a projection). Output is capped at `options.maxItems` (default 1000) to prevent
 * DoS via unbounded field counts.
 *
 * @param input Raw query value.
 * @param options Optional cap override.
 * @returns The parsed list of dotted field paths, or `null` when no projection was
 *   requested — caller should return every field in that case.
 */
export function parseFields(input: string | string[] | null | undefined, options?: ParseFieldsOptions): string[] | null;
