/**
 * Parse a `?names=` query value or JSON body. Accepts a comma-separated
 * string or an array. Returns `[]` on missing/empty input.
 *
 * @param input Raw value.
 */
export function parseNames(input: string | string[] | null | undefined): string[];
