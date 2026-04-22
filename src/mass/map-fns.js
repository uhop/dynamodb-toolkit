// Canned mapFn builders for mass clone/move operations. Each one returns a
// synchronous `(item) => item'` callback suitable for passing as the `mapFn`
// argument to clone/move/edit mass primitives.
//
// `mergeMapFn` is adapter-agnostic and free-exported. `swapPrefix` and
// `overlayFields` are Adapter methods (defined in adapter.js) because they
// need `keyFields` / `structuralKey` information for validation.

/**
 * Compose multiple mapFns into a single mapFn. Runs them left-to-right:
 * `mergeMapFn(f, g, h)(x) === h(g(f(x)))`. When any mapFn returns a falsy
 * value, the composition short-circuits and returns that falsy value — so
 * mass-op `filter-out` semantics (returning `null` / `undefined` to skip
 * the item) carry through the chain.
 *
 * @param fns Mapping functions to compose.
 * @returns A single mapFn equivalent to applying each in sequence.
 */
export const mergeMapFn = (...fns) => {
  // Flatten one level so callers can pass arrays too, e.g. mergeMapFn(...fnsArr).
  const chain = fns.filter(Boolean);
  if (!chain.length) return x => x;
  if (chain.length === 1) return chain[0];
  return item => {
    let cur = item;
    for (const fn of chain) {
      if (!cur) return cur;
      cur = fn(cur);
    }
    return cur;
  };
};
