export type MatchedRoute =
  | {kind: 'root'; method: string}
  | {kind: 'collectionMethod'; name: string; method: string}
  | {kind: 'item'; key: string; method: string}
  | {kind: 'itemMethod'; key: string; name: string; method: string}
  | {kind: 'unknown'; method: string};

export function matchRoute(method: string, path: string, methodPrefix?: string): MatchedRoute;
