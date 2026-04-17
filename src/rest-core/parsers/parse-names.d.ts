/**
 * Parse a `?names=` query value or JSON body. Accepts a comma-separated
 * string or an array. Returns `[]` on missing/empty input.
 *
 * @param input Raw value.
 * @returns A list of trimmed names in input order — empty array (never `null`) when
 *   nothing was supplied, so callers can iterate unconditionally.
 */
export function parseNames(input: string | string[] | null | undefined): string[];
