/**
 * Build a `prepare` hook that stamps `fieldName` with `new Date().toISOString()`
 * on first insert. Items that already carry the field (e.g., round-tripped from
 * a prior read) are untouched; patches are untouched.
 *
 * Generic in the item shape so it flows through a user's `Adapter<TItem>`
 * hook types — compose via `stampCreatedAtISO<TItem>('_createdAt')`.
 *
 * @param fieldName Name of the timestamp field. Defaults to `'_createdAt'`.
 * @returns A `prepare`-shaped hook typed to the caller's item shape.
 */
export function stampCreatedAtISO<T extends Record<string, unknown>>(fieldName?: string): (item: T, isPatch?: boolean) => T;

/**
 * Build a `prepare` hook that stamps `fieldName` with `Date.now()` (epoch
 * milliseconds) on first insert. Items that already carry the field are
 * untouched; patches are untouched.
 *
 * Generic in the item shape — see {@link stampCreatedAtISO}.
 *
 * @param fieldName Name of the timestamp field. Defaults to `'_createdAt'`.
 * @returns A `prepare`-shaped hook typed to the caller's item shape.
 */
export function stampCreatedAtEpoch<T extends Record<string, unknown>>(fieldName?: string): (item: T, isPatch?: boolean) => T;
