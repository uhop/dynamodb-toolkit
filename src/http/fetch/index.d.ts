import type {Adapter} from '../../index.js';
import type {RestPolicyOverrides} from '../../rest-core/index.js';

/** Return value from {@link FetchAdapterOptions.onMiss}. */
export type OnMissResult = Response | null | Promise<Response | null>;

/**
 * Context passed to {@link FetchAdapterOptions.exampleFromContext}. Mirrors
 * the shape used by the other framework adapters so cross-adapter callbacks
 * can branch on `framework`.
 */
export interface FetchExampleContext<TItem extends Record<string, unknown> = Record<string, unknown>> {
  /** Parsed URL query-string (first value per repeated key). */
  query: Record<string, string>;
  /**
   * Parsed JSON body. Always the parsed body before the call — `null` only
   * when the request had no body, not as a placeholder for unread bodies.
   */
  body: unknown;
  /** The Adapter targeted by this handler. */
  adapter: Adapter<TItem>;
  /** Discriminator for cross-adapter callbacks. */
  framework: 'fetch';
  /**
   * The incoming Fetch `Request`. `request.body` is already consumed by the
   * time `exampleFromContext` runs — inspect `request.headers`, `request.url`,
   * or host-specific context (e.g. Cloudflare Workers' `request.cf`).
   */
  request: Request;
}

/** Options for {@link createFetchAdapter}. */
export interface FetchAdapterOptions<TItem extends Record<string, unknown> = Record<string, unknown>> {
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
   * Takes an options bag of `{query, body, adapter, framework: 'fetch', request}`;
   * the shape matches the other framework adapters so a tenant-scoping
   * callback can be shared across koa, express, fetch, and lambda.
   */
  exampleFromContext?: (context: FetchExampleContext<TItem>) => Record<string, unknown>;
  /**
   * Cap for the request body in bytes. Enforced on every body-reading route.
   * The adapter rejects with `413 PayloadTooLarge` either before reading
   * (when a declared `Content-Length` exceeds the cap) or mid-stream (when a
   * chunked request crosses it).
   *
   * Default: `1048576` (1 MiB), matching the bundled `node:http` handler and
   * the koa / express adapters.
   */
  maxBodyBytes?: number;
  /**
   * Path prefix the adapter is mounted under. Stripped from the incoming
   * pathname before route matching.
   *
   * Use when the adapter shares a server with other handlers
   * (`createFetchAdapter(planets, {mountPath: '/planets'})`). Leave unset
   * when the adapter owns every URL on the runtime (typical for a
   * single-collection Cloudflare Worker or `Deno.serve` handler).
   *
   * A request whose pathname is neither equal to `mountPath` nor starts
   * with `mountPath + '/'` is treated as a miss (see {@link onMiss}).
   */
  mountPath?: string;
  /**
   * Hook invoked when the request can't be dispatched to a known route:
   * - pathname isn't under {@link mountPath}, or
   * - `matchRoute` returns `'unknown'` for this method + path.
   *
   * Providing this option relaxes the handler's return type to include
   * `null`, so callers can compose the adapter into a larger router
   * (Hono, itty-router, a Workers-level `fetch` dispatch) by returning
   * `null` from `onMiss` when this adapter doesn't own the request.
   *
   * Without `onMiss`, the adapter is terminal — every miss becomes an
   * empty `404 Response`.
   *
   * @param request The incoming Fetch `Request` that didn't match any route.
   * @returns `Response` to ship a concrete response; `null` to signal
   *   "not my request" so the caller can try the next handler;
   *   `undefined` is treated as "use the default 404".
   */
  onMiss?: (request: Request) => OnMissResult | undefined | void;
}

/**
 * Build a Fetch-handler middleware that serves the standard dynamodb-toolkit
 * REST route pack against the supplied Adapter.
 *
 * Routes (all rooted at {@link FetchAdapterOptions.mountPath}, or at `/` when
 * no mount is set):
 * - `GET/POST/DELETE /` — getList / post / deleteListByParams
 * - `GET /-by-names`, `DELETE /-by-names` — getByKeys / deleteByKeys
 * - `PUT /-load` — bulk putItems
 * - `PUT /-clone`, `PUT /-move` — cloneListByParams / moveListByParams (body is overlay)
 * - `PUT /-clone-by-names`, `PUT /-move-by-names` — cloneByKeys / moveByKeys
 * - `GET/PUT/PATCH/DELETE /:key` — getByKey / put / patch / delete
 * - `PUT /:key/-clone`, `PUT /:key/-move` — single-item clone / move
 *
 * Dispatch behavior:
 * - Unknown route or off-mount request → fall through {@link FetchAdapterOptions.onMiss}
 *   (when provided), else empty `404 Response`.
 * - Known shape, unsupported method → `405 Method Not Allowed` with a JSON body.
 * - Thrown errors map through `policy.errorBody` + `mapErrorStatus` into a
 *   JSON body plus the matching status code.
 *
 * Runs on any runtime with the standard Fetch API: Cloudflare Workers, Deno
 * Deploy, Bun.serve, Hono (via `c.req.raw`), itty-router, and Node 20+
 * (`node:http` with `fetch` helpers, or Bun-on-Node shims).
 *
 * @param adapter The dynamodb-toolkit Adapter that performs the DynamoDB work.
 * @param options Policy, mount prefix, sortable indices, key / example
 *   extractors, body cap, optional miss hook.
 * @returns A Fetch handler `(request) => Promise<Response>`. The return type
 *   widens to `Promise<Response | null>` when `onMiss` is provided, so the
 *   adapter can cleanly yield control back to a parent router.
 */
export function createFetchAdapter<TItem extends Record<string, unknown> = Record<string, unknown>>(
  adapter: Adapter<TItem>,
  options: FetchAdapterOptions<TItem> & {onMiss: NonNullable<FetchAdapterOptions<TItem>['onMiss']>}
): (request: Request) => Promise<Response | null>;
export function createFetchAdapter<TItem extends Record<string, unknown> = Record<string, unknown>>(
  adapter: Adapter<TItem>,
  options?: FetchAdapterOptions<TItem>
): (request: Request) => Promise<Response>;
