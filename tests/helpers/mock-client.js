// Cross-runtime stand-in for `node:test`'s `mock.fn()` — Bun doesn't implement
// `mock.fn`, and Deno's coverage is partial. We only need the subset our tests
// actually touch: `client.send.mock.callCount()` and `.mock.restore()`.

export const makeMockClient = handler => {
  let callCount = 0;
  const send = async (...args) => {
    ++callCount;
    return handler(...args);
  };
  send.mock = {
    callCount: () => callCount,
    restore: () => {}
  };
  return {send};
};
