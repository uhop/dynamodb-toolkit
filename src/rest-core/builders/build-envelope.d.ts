import type {PaginatedResult} from '../../mass/paginate-list.js';
import type {CursorPage} from '../../mass/cursor-list.js';

/** Key-name overrides for the pagination envelope. */
export interface EnvelopeKeys {
  /** Key for the items array. Default `'data'`. */
  items?: string;
  /** Key for the total count. Default `'total'`. */
  total?: string;
  /** Key for the offset. Default `'offset'`. */
  offset?: string;
  /** Key for the limit. Default `'limit'`. */
  limit?: string;
  /** Key for the next-page cursor (cursor paging). Default `'cursor'`. */
  cursor?: string;
  /** Key for the prev/next links block. Default `'links'`. */
  links?: string;
}

/** Options for {@link buildEnvelope}. */
export interface BuildEnvelopeOptions {
  /** Key-name overrides. */
  keys?: EnvelopeKeys;
  /** Optional prev/next links to embed in the envelope. */
  links?: {prev: string | null; next: string | null};
}

/**
 * Wrap a paginated result in a configurable-key envelope. Handles both paging
 * shapes: offset results emit `{data, offset, limit, total?}`; cursor pages
 * emit `{data, limit, cursor?}`. Only defined members appear — `total` is
 * omitted when missing (e.g. `needTotal: false`), `offset` when absent
 * (cursor mode), `cursor` when the listing is exhausted.
 *
 * @param result The toolkit's paginated result or cursor page.
 * @param options Key overrides and optional `links` block.
 * @returns A wire-ready envelope — keys follow `options.keys` (or defaults).
 */
export function buildEnvelope(result: PaginatedResult | CursorPage, options?: BuildEnvelopeOptions): Record<string, unknown>;
