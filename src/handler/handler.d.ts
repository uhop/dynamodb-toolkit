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
   * Convert the URL `:key` segment into a key object. Runs on every keyed
   * route (`GET /:key`, `PUT /:key`, `PATCH /:key`, `DELETE /:key`, the
   * single-item clone/move endpoints).
   *
   * - `rawKey` — the raw `:key` path segment, URL-decoded, string.
   * - `adapter` — the target Adapter; use `adapter.keyFields` to know what
   *   fields to populate.
   *
   * Return a full key object: every entry in `adapter.keyFields` must be
   * a property of the returned object. The returned value becomes the
   * `key` passed to `adapter.getByKey` / `put` / `patch` / `delete`.
   *
   * Default: `(raw, adapter) => ({[adapter.keyFields[0]]: raw})` — takes
   * the raw string as the partition key. Override for composite keys
   * (e.g. `${partition}:${sort}` → `{part, sort}`), or to coerce types
   * (numeric partition keys, UUID validation).
   */
  keyFromPath?: (rawKey: string, adapter: Adapter<Record<string, unknown>>) => Record<string, unknown>;
  /**
   * Build the `example` object passed to the Adapter's `prepareListInput`
   * hook from the current request. Runs on `GET /`, `GET /-by-names`, and
   * the `-clone` / `-move` bulk endpoints.
   *
   * - `query` — parsed URL query-string object, `Record<string, string>`.
   * - `body` — parsed request body, `unknown` (the handler's JSON parser
   *   returns whatever was sent; consumers typically narrow to
   *   `Record<string, unknown> | unknown[]`).
   *
   * Return a partial item: this becomes the `example` argument of
   * `Adapter.prepareListInput(example, index)`, which is typically used
   * to seed a `KeyConditionExpression` (e.g. `{tenant: query.tenant}`
   * for a per-tenant list).
   *
   * Default: `() => ({})` — pass nothing to `prepareListInput`, which
   * makes sense when the Adapter's hook derives everything from `index`
   * alone.
   */
  exampleFromContext?: (query: Record<string, string>, body: unknown) => Record<string, unknown>;
  /**
   * Maximum request-body size in bytes. Bodies that exceed this are rejected
   * with HTTP 413 (`PayloadTooLarge`). Defends against memory-exhaustion DoS.
   * Default `1048576` (1 MB).
   */
  maxBodyBytes?: number;
}

/**
 * Build a `(req, res) =>` handler that wires the standard route pack to the
 * given Adapter. Routes:
 * - `GET/POST/DELETE /` — getAll / post / deleteAllByParams
 * - `GET /-by-names`, `DELETE /-by-names` — getByKeys (length-preserving,
 *   `null` at missing positions) / deleteByKeys (idempotent)
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
