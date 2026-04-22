/**
 * A mapFn — synchronous transform from one item to another. Returning a
 * falsy value (e.g. `null`) signals mass-op primitives to drop the item
 * from the operation.
 */
export type MapFn<T = Record<string, unknown>> = (item: T) => T | null | undefined | false;

/**
 * Compose multiple mapFns into a single mapFn applied left-to-right.
 * Short-circuits on the first falsy return — mass-op `drop this item`
 * semantics carry through the chain.
 *
 * @param fns Mapping functions to compose.
 * @returns A single mapFn equivalent to applying each in sequence.
 */
export function mergeMapFn<T = Record<string, unknown>>(...fns: (MapFn<T> | undefined | null | false)[]): MapFn<T>;
