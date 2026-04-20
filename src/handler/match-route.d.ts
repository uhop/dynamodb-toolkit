/**
 * Discriminated union returned by {@link matchRoute}.
 *
 * `method` is the *effective* method after HEAD→GET promotion — HEAD requests
 * dispatch through the GET handler. `head: true` signals the original was a
 * HEAD; callers should suppress the response body but keep headers + status.
 */
export type MatchedRoute =
  /** Root URL (`/`) for a given method. */
  | {kind: 'root'; method: string; head: boolean}
  /** Method URL on the collection (`/-by-names`, `/-clone`, …). */
  | {kind: 'collectionMethod'; name: string; method: string; head: boolean}
  /** Single item URL (`/<key>`). */
  | {kind: 'item'; key: string; method: string; head: boolean}
  /** Method URL on a single item (`/<key>/-clone`). */
  | {kind: 'itemMethod'; key: string; name: string; method: string; head: boolean}
  /** No standard route matched (deeper nesting, unexpected prefix). */
  | {kind: 'unknown'; method: string; head: boolean};

/**
 * Match an HTTP method + URL pathname against the standard route shapes.
 * URL-decodes key segments. Configurable method prefix.
 *
 * `HEAD` requests are matched as `GET` (so they dispatch through the same
 * read-side handler) and annotated with `head: true` on the result so the
 * caller can skip body writes in the response — the REST convention is that
 * HEAD returns the same headers + `Content-Length` as the equivalent GET
 * but an empty body.
 *
 * @param method Request method (e.g. `'GET'`).
 * @param path URL pathname (no query string).
 * @param methodPrefix Character(s) that mark method URLs. Default `'-'`.
 * @returns A discriminated-union route object — switch on `kind` to dispatch.
 *   `unknown` means the path didn't match any standard route; treat as 404.
 */
export function matchRoute(method: string, path: string, methodPrefix?: string): MatchedRoute;
