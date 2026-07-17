import type {Request, RequestHandler} from 'express';

import type {Adapter} from '../../index.js';
import type {RestPolicyOverrides} from '../../rest-core/index.js';

/**
 * Context passed to {@link ExpressAdapterOptions.exampleFromContext}. Mirrors
 * the shape used by the other framework adapters so cross-adapter callbacks
 * can branch on `framework`.
 */
export interface ExpressExampleContext<TItem extends Record<string, unknown> = Record<string, unknown>> {
  /** Parsed URL query-string. Arrays / nested objects have already been normalized. */
  query: Record<string, string>;
  /**
   * Parsed JSON body. Always the parsed body before the call — `null` only
   * when the request had no body, not as a placeholder for unread bodies.
   */
  body: unknown;
  /** The Adapter targeted by this middleware. */
  adapter: Adapter<TItem>;
  /** Discriminator for cross-adapter callbacks. */
  framework: 'express';
  /** Express `Request` — pull auth / headers / ip from upstream middleware. */
  req: Request;
}

/** Options for {@link createExpressAdapter}. */
export interface ExpressAdapterOptions<TItem extends Record<string, unknown> = Record<string, unknown>> {
  /** Partial overrides for the REST policy (merged with the default). */
  policy?: RestPolicyOverrides;
  /**
   * Map from sort-field name to the GSI index that provides that ordering.
   * `?sort=name` becomes `{index: sortableIndices.name, descending: false}`.
   */
  sortableIndices?: Record<string, string>;
  /**
   * Convert the URL `:key` segment into a key object. Runs on every keyed
   * route (`GET /:key`, `PUT /:key`, `PATCH /:key`, `DELETE /:key`, and the
   * single-item `-clone` / `-move` endpoints).
   *
   * Default: `(raw, adp) => ({[adp.keyFields[0].name]: raw})` — the raw
   * string becomes the partition key. Override for composite keys (e.g.
   * `${partition}:${sort}` → `{partition, sort}`), numeric coercion, or
   * URL-format validation.
   *
   * @param rawKey The URL-decoded `:key` path segment, always a string.
   * @param adapter The target Adapter. Inspect `adapter.keyFields` to decide
   *   which fields to populate when writing a generic callback.
   * @returns The full key object. Every entry in `adapter.keyFields` must be
   *   a property of the returned object; the return value flows directly
   *   into `adapter.getByKey` / `put` / `patch` / `delete`.
   */
  keyFromPath?: (rawKey: string, adapter: Adapter<TItem>) => Record<string, unknown>;
  /**
   * Build the `example` object passed to `Adapter.prepareListInput` from the
   * current request. Runs on `GET /`, `DELETE /`, and the `PUT /-clone` /
   * `PUT /-move` bulk endpoints — the collection-level routes that invoke
   * the Adapter's list-params machinery.
   *
   * Default: `() => ({})` — no example; `prepareListInput` derives
   * everything from the `index` argument alone.
   *
   * Takes an options bag of `{query, body, adapter, framework: 'express', req}`;
   * the shape matches the other framework adapters so a tenant-scoping
   * callback can be shared across koa, express, fetch, and lambda.
   */
  exampleFromContext?: (context: ExpressExampleContext<TItem>) => Record<string, unknown>;
  /**
   * Cap for the raw request body in bytes. Enforced only when the consumer
   * has not pre-parsed the body (i.e. `req.body` is `undefined`). If an
   * Express body-parser such as `express.json()` is in the chain, that
   * parser's cap applies instead.
   *
   * Default: `1048576` (1 MiB), matching the bundled `node:http` handler.
   * Measured in bytes via the extracted `readJsonBody` helper, not UTF-16
   * code units as the 0.1.x variant did.
   */
  maxBodyBytes?: number;
}

/**
 * Build an Express middleware that serves the standard dynamodb-toolkit REST
 * route pack against the supplied Adapter. Mount at a path prefix with
 * `app.use('/planets', createExpressAdapter(adapter))` so `req.path` is
 * relative to the collection root.
 *
 * Routes (all rooted at the mount point):
 * - `GET/POST/DELETE /` — getList / post / deleteListByParams
 * - `GET /-by-names`, `DELETE /-by-names` — getByKeys / deleteByKeys
 * - `PUT /-load` — bulk putItems
 * - `PUT /-clone`, `PUT /-move` — cloneListByParams / moveListByParams (body is overlay)
 * - `PUT /-clone-by-names`, `PUT /-move-by-names` — cloneByKeys / moveByKeys
 * - `GET/PUT/PATCH/DELETE /:key` — getByKey / put / patch / delete
 * - `PUT /:key/-clone`, `PUT /:key/-move` — single-item clone / move
 *
 * Dispatch behavior:
 * - Unrecognized route shape → `next()` — other middleware can respond.
 * - Known shape, unsupported method → `405 Method Not Allowed`.
 * - Thrown errors map through `policy.errorBody` + `mapErrorStatus` into a
 *   JSON body plus the matching status code. Unexpected failures after the
 *   response has begun are forwarded to `next(err)` so the Express error
 *   pipeline can finish the socket.
 *
 * Peer range supports Express `^4.21.0 || ^5.0.0`. In Express 4, async
 * handlers don't auto-await — the adapter wraps its own dispatch so that
 * unhandled rejections still surface through `next(err)` regardless of
 * Express version.
 *
 * @param adapter The dynamodb-toolkit Adapter that performs the DynamoDB work.
 * @param options Policy, sortable indices, key / example extractors, body cap.
 * @returns An Express `RequestHandler` suitable for `app.use` or
 *   `app.use('/planets', ...)`.
 */
export function createExpressAdapter<TItem extends Record<string, unknown> = Record<string, unknown>>(
  adapter: Adapter<TItem>,
  options?: ExpressAdapterOptions<TItem>
): RequestHandler;
