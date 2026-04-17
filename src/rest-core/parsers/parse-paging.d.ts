/** Options for {@link parsePaging}. */
export interface ParsePagingOptions {
  /** Default limit when the caller doesn't supply one or supplies garbage. Default `10`. */
  defaultLimit?: number;
  /** Maximum limit accepted; anything larger is clamped. Default `100`. */
  maxLimit?: number;
}

/** Return shape of {@link parsePaging}. */
export interface ParsedPaging {
  /** Non-negative integer offset. */
  offset: number;
  /** Clamped, positive integer limit. */
  limit: number;
}

/**
 * Parse `?offset=` / `?limit=` query values with sensible defaults and a hard
 * ceiling. Negative offsets clamp to `0`; non-numeric inputs fall back to
 * defaults.
 *
 * @param input Raw values — strings or numbers.
 * @param options `defaultLimit` and `maxLimit`.
 */
export function parsePaging(input?: {offset?: string | number; limit?: string | number} | null, options?: ParsePagingOptions): ParsedPaging;
