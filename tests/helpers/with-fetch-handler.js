// Fetch adapters are terminal — no server, no ports. The harness is just a
// `(pathAndQuery, init?) => Promise<Response>` wrapper that constructs a full
// `Request` from a fixed origin and invokes the handler directly. Mirrors the
// koa/express `with*Server` harness in shape, minus the listen/teardown.

const ORIGIN = 'http://local.test';

export const makeClient = handler => (pathAndQuery, init) => handler(new Request(new URL(pathAndQuery, ORIGIN), init));

// Convenience wrapper that keeps test bodies aligned with the sibling
// adapters' `withExpressServer(middleware, async base => { ... })` shape —
// the callback receives a `fetch`-compatible client rather than a base URL.
export const withFetchHandler = async (handler, fn) => {
  const client = makeClient(handler);
  return fn(client);
};
