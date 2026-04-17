/** Options for {@link buildFilter}. */
export interface FilterOptions {
  /** Restrict search to a subset of the `searchable` fields. */
  fields?: string | string[] | null;
  /** Mirror-column prefix. Default `'-search-'`. */
  prefix?: string;
  /** When `false` (default), the query string is lowercased before matching. */
  caseSensitive?: boolean;
}

/**
 * Build a substring `FilterExpression` over lowercase mirror columns
 * (`<prefix><field>`). Consumers typically populate the mirrors in their
 * `prepare` hook. Mutates and returns `params`.
 *
 * @param searchable Map of searchable field names (value is a truthy marker).
 * @param query Search string. When empty / null, `params` is returned unchanged.
 * @param options Prefix, case sensitivity, and field restriction.
 * @param params Existing DynamoDB params to extend. A fresh object is used when omitted.
 */
export function buildFilter<T extends Record<string, unknown>>(
  searchable: Record<string, 1 | true>,
  query: string | null | undefined,
  options?: FilterOptions,
  params?: T
): T;

/**
 * Build an equality `FilterExpression` from a partial example object —
 * `{climate: 'frozen', gravity: '1 standard'}` becomes
 * `#fbe0 = :fbe0 AND #fbe1 = :fbe1`. Mutates and returns `params`.
 *
 * @param example Partial object; every key/value pair becomes an equality clause.
 * @param params Existing DynamoDB params to extend. A fresh object is used when omitted.
 */
export function buildFilterByExample<T extends Record<string, unknown>>(example: Record<string, unknown>, params?: T): T;
