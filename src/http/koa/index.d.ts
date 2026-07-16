import type {Context, Middleware} from 'koa';

import type {Adapter} from '../../index.js';
import type {RestPolicy} from '../../rest-core/index.js';

/**
 * Context passed to {@link KoaAdapterOptions.exampleFromContext}. Mirrors the
 * shape used by the other framework adapters so cross-adapter callbacks can
 * branch on `framework`.
 */
export interface KoaExampleContext<TItem extends Record<string, unknown> = Record<string, unknown>> {
  /** Parsed URL query-string. Array values are collapsed to the first string element. */
  query: Record<string, string>;
  /**
   * Parsed JSON body. Always the parsed body before the call — `null` only
   * when the request had no body, not as a placeholder for unread bodies.
   */
  body: unknown;
  /** The Adapter targeted by this middleware. */
  adapter: Adapter<TItem>;
  /** Discriminator for cross-adapter callbacks. */
  framework: 'koa';
  /** Koa `Context` — pull auth / headers / ip from upstream middleware. */
  ctx: Context;
}

/** Options for {@link createKoaAdapter}. */
export interface KoaAdapterOptions<TItem extends Record<string, unknown> = Record<string, unknown>> {
  /** Partial overrides for the REST policy (merged with the default). */
  policy?: Partial<RestPolicy>;
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
   * Takes an options bag of `{query, body, adapter, framework: 'koa', ctx}`;
   * the shape matches the other framework adapters so a tenant-scoping
   * callback can be shared across koa, express, fetch, and lambda.
   */
  exampleFromContext?: (context: KoaExampleContext<TItem>) => Record<string, unknown>;
  /**
   * Cap for the raw request body in bytes. Enforced only when the consumer
   * has not pre-parsed the body (i.e. `ctx.request.body` is `undefined`). If
   * a Koa body-parser is in the chain, that parser's cap applies instead.
   *
   * Default: `1048576` (1 MiB), matching the bundled `node:http` handler.
   * Measured in bytes via the extracted `readJsonBody` helper, not UTF-16
   * code units as the 0.1.x variant did.
   */
  maxBodyBytes?: number;
}

/**
 * Build a Koa middleware that serves the standard dynamodb-toolkit REST
 * route pack against the supplied Adapter. Mount with `koa-mount` (or another
 * prefix-stripping mechanism) so `ctx.path` is relative to the collection
 * root.
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
 * - Unrecognized route shape → `await next()` — other middleware can respond.
 * - Known shape, unsupported method → `405 Method Not Allowed`.
 * - `HEAD /:key` auto-promotes to `GET /:key` via the parent toolkit's
 *   `matchRoute`; body is sent as normal (Koa strips it for HEAD).
 * - Thrown errors map through `policy.errorBody` + `mapErrorStatus` into a
 *   JSON body plus the matching status code.
 *
 * Write routes (POST /, PUT /:key, PATCH /:key) reject non-object bodies with
 * `400 BadBody` at the rest-core boundary — the parent toolkit's
 * `validateWriteBody` is wired in.
 *
 * @param adapter The dynamodb-toolkit Adapter that performs the DynamoDB work.
 * @param options Policy, sortable indices, key / example extractors, body cap.
 * @returns A Koa `Middleware` suitable for `app.use` or `mount('/planets', ...)`.
 */
export function createKoaAdapter<TItem extends Record<string, unknown> = Record<string, unknown>>(
  adapter: Adapter<TItem>,
  options?: KoaAdapterOptions<TItem>
): Middleware;
