/**
 * Parse a `?fields=` query value. Accepts a comma-separated string or array.
 * Returns `null` when the input is missing or empty (caller should not apply
 * a projection).
 *
 * @param input Raw query value.
 */
export function parseFields(input: string | string[] | null | undefined): string[] | null;
