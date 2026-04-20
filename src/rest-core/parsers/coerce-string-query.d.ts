/**
 * Coerce a framework query object into `Record<string, string>`. Values that
 * aren't strings (nested objects from `qs`, numbers, etc.) are dropped; for
 * arrays, the first string element wins. Accumulator uses a null prototype so
 * `?constructor=…` / `?__proto__=…` keys don't shadow inherited members.
 *
 * @param query Framework-supplied query bag. `null` / `undefined` → `{}`.
 * @returns A string-only query map.
 */
export function coerceStringQuery(query: Record<string, unknown> | null | undefined): Record<string, string>;
