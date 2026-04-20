// Coerce a framework query object into `Record<string, string>` — filter values
// to strings only. Useful when the framework's qs parser hands back nested
// objects or arrays (Express's `qs`, Koa's `ctx.query`, etc.). Non-string
// values are dropped; for arrays, the first string element wins.
//
// Uses a null-prototype accumulator so `?constructor=…` / `?__proto__=…` can
// never shadow inherited Object members. Downstream parsers do their own
// validation; this helper only normalizes shape.

export const coerceStringQuery = query => {
  const out = Object.create(null);
  if (!query) return out;
  for (const k of Object.keys(query)) {
    const v = query[k];
    if (typeof v === 'string') {
      out[k] = v;
    } else if (Array.isArray(v) && typeof v[0] === 'string') {
      out[k] = v[0];
    }
  }
  return out;
};
