/**
 * A placeholder allocator bound to one `params` object and one prefix pair.
 * Internal helper behind every expression builder — not part of the public
 * `dynamodb-toolkit/expressions` surface.
 */
export interface ExpressionAllocator {
  /** The live `ExpressionAttributeNames` map — pre-existing entries preserved. */
  names: Record<string, string>;
  /** The live `ExpressionAttributeValues` map — pre-existing entries preserved. */
  values: Record<string, unknown>;
  /** Mint a name alias (`<namePrefix><n>`), record `fieldName` under it, return it. */
  name(fieldName: string): string;
  /** Mint a value alias (`<valuePrefix><n>`), record `val` under it, return it. */
  value(val: unknown): string;
  /** Attach non-empty maps back onto `params`. Returns `params`. */
  commit(): Record<string, unknown>;
}

/**
 * Create an allocator over `params` for one builder invocation. Counters are
 * seeded from the sizes of the maps already on `params`, so aliases minted by
 * earlier builders on the same `params` are never reused — the per-builder
 * `namePrefix` / `valuePrefix` keep the alias namespaces disjoint on top of
 * that.
 *
 * @param params DynamoDB command input under construction.
 * @param namePrefix Alias prefix for `ExpressionAttributeNames` (e.g. `'#cd'`).
 * @param valuePrefix Alias prefix for `ExpressionAttributeValues` (e.g. `':cdv'`).
 *   Omit for names-only builders — calling `value()` then is caller error (GIGO).
 * @returns The allocator.
 */
export function makeAllocator(params: Record<string, unknown>, namePrefix: string, valuePrefix?: string): ExpressionAllocator;
