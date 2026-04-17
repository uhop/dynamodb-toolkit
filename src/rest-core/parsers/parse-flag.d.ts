/**
 * Parse a truthy query flag. Accepts `'yes'` / `'true'` / `'1'` / `'on'`
 * (case-insensitive) and booleans. Anything else returns `false`.
 *
 * @param input Raw query value or boolean.
 */
export function parseFlag(input: string | boolean | null | undefined): boolean;
