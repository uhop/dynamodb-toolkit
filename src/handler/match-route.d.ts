/** Discriminated union returned by {@link matchRoute}. */
export type MatchedRoute =
  /** Root URL (`/`) for a given method. */
  | {kind: 'root'; method: string}
  /** Method URL on the collection (`/-by-names`, `/-clone`, …). */
  | {kind: 'collectionMethod'; name: string; method: string}
  /** Single item URL (`/<key>`). */
  | {kind: 'item'; key: string; method: string}
  /** Method URL on a single item (`/<key>/-clone`). */
  | {kind: 'itemMethod'; key: string; name: string; method: string}
  /** No standard route matched (deeper nesting, unexpected prefix). */
  | {kind: 'unknown'; method: string};

/**
 * Match an HTTP method + URL pathname against the standard route shapes.
 * URL-decodes key segments. Configurable method prefix.
 *
 * @param method Request method (e.g. `'GET'`).
 * @param path URL pathname (no query string).
 * @param methodPrefix Character(s) that mark method URLs. Default `'-'`.
 */
export function matchRoute(method: string, path: string, methodPrefix?: string): MatchedRoute;
