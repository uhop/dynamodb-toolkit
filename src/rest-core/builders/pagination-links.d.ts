/** Prev / next pagination link pair. Both are `null` when at the corresponding edge. */
export interface PaginationLinks {
  /** Link to the previous page, or `null` when at `offset=0`. */
  prev: string | null;
  /** Link to the next page, or `null` when `offset + limit >= total`. */
  next: string | null;
}

/**
 * Caller-provided URL builder. Given `{offset, limit}`, returns the URL for
 * that window.
 */
export type UrlBuilder = (input: {offset: number; limit: number}) => string;

/**
 * Compute prev / next pagination links. Without a `urlBuilder` both links
 * come back `null`.
 *
 * @param offset Current offset.
 * @param limit Current limit (page size).
 * @param total Total matches. When omitted, `next` is always produced (caller decides when to stop).
 * @param urlBuilder Function that renders a URL for a given window.
 */
export function paginationLinks(offset: number, limit: number, total: number | undefined, urlBuilder?: UrlBuilder): PaginationLinks;
