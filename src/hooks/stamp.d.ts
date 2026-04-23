/**
 * Build a `prepare` hook that stamps `fieldName` with `new Date().toISOString()`
 * on first insert. Items that already carry the field (e.g., round-tripped from
 * a prior read) are untouched; patches are untouched.
 *
 * @param fieldName Name of the timestamp field. Defaults to `'_createdAt'`.
 * @returns A `prepare`-shaped hook.
 */
export function stampCreatedAtISO(fieldName?: string): (item: Record<string, unknown>, isPatch?: boolean) => Record<string, unknown>;

/**
 * Build a `prepare` hook that stamps `fieldName` with `Date.now()` (epoch
 * milliseconds) on first insert. Items that already carry the field are
 * untouched; patches are untouched.
 *
 * @param fieldName Name of the timestamp field. Defaults to `'_createdAt'`.
 * @returns A `prepare`-shaped hook.
 */
export function stampCreatedAtEpoch(fieldName?: string): (item: Record<string, unknown>, isPatch?: boolean) => Record<string, unknown>;
