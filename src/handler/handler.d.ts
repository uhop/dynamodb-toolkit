import type {IncomingMessage, ServerResponse} from 'node:http';

import type {Adapter} from '../adapter/adapter.js';
import type {RestPolicy} from '../rest-core/policy.js';

/** `(req, res) =>` request handler compatible with `node:http.createServer`. */
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Options for {@link createHandler}. */
export interface HandlerOptions {
  /** Partial overrides for the REST policy (merged with the default). */
  policy?: Partial<RestPolicy>;
  /**
   * Map from sort-field name to the GSI index that provides that ordering.
   * `?sort=name` becomes `{index: sortableIndices.name, descending: false}`.
   */
  sortableIndices?: Record<string, string>;
  /**
   * Convert the URL `:key` segment into a key object.
   * Default: `(raw, adapter) => ({[adapter.keyFields[0]]: raw})`.
   * Override for composite keys.
   */
  keyFromPath?: (rawKey: string, adapter: Adapter<Record<string, unknown>>) => Record<string, unknown>;
  /**
   * Produce an "example" object for `prepareListInput(example, index)` from
   * the current request context. Default returns `{}`.
   */
  exampleFromContext?: (query: Record<string, string>, body: unknown) => Record<string, unknown>;
}

/**
 * Build a `(req, res) =>` handler that wires the standard route pack to the
 * given Adapter. Routes:
 * - `GET/POST/DELETE /` — getAll / post / deleteAllByParams
 * - `GET /-by-names`, `DELETE /-by-names` — getByKeys / deleteByKeys
 * - `PUT /-load` — bulk putAll
 * - `PUT /-clone`, `PUT /-move` — cloneAllByParams / moveAllByParams (body is overlay)
 * - `PUT /-clone-by-names`, `PUT /-move-by-names` — cloneByKeys / moveByKeys
 * - `GET/PUT/PATCH/DELETE /:key` — getByKey / put / patch / delete
 * - `PUT /:key/-clone`, `PUT /:key/-move` — single-item clone / move
 *
 * @param adapter Target Adapter.
 * @param options Policy, sortable indices, key/example extractors.
 * @returns A `(req, res) => Promise<void>` ready to plug into `http.createServer`
 *   (or any Node-stream-shaped server). Writes the response and resolves — the
 *   caller never needs to touch `res` themselves.
 */
export function createHandler(adapter: Adapter<Record<string, unknown>>, options?: HandlerOptions): RequestHandler;
