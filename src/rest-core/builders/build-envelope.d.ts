import type {PaginatedResult} from '../../mass/paginate-list.js';

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
 * Wrap a paginated result in a configurable-key envelope. `total` is omitted
 * when missing (e.g. when `paginateList` was called with `needTotal: false`).
 *
 * @param result The toolkit's paginated result shape.
 * @param options Key overrides and optional `links` block.
 * @returns A wire-ready envelope — keys follow `options.keys` (or defaults), and only
 *   defined members appear (`total`/`links` omitted when absent in the source).
 */
export function buildEnvelope(result: PaginatedResult, options?: BuildEnvelopeOptions): Record<string, unknown>;
