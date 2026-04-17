/**
 * Parse a `?fields=` query value. Accepts a comma-separated string or array.
 * Returns `null` when the input is missing or empty (caller should not apply
 * a projection).
 *
 * @param input Raw query value.
 * @returns The parsed list of dotted field paths, or `null` when no projection was
 *   requested — caller should return every field in that case.
 */
export function parseFields(input: string | string[] | null | undefined): string[] | null;
