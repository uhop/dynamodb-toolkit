// Parse `f-<field>-<op>=<value>` query parameters into a structured clause
// list. Pure shape extraction — no type coercion, no allowlist check. The
// adapter's `applyFFilter` compiles these clauses into FilterExpression /
// KeyConditionExpression using its declared `filterable` allowlist +
// keyFields / indices metadata.
//
// Field names may contain dashes, so the split is from the RIGHT against a
// closed op set. `cost` + `gt` from `f-cost-gt`; `rental-name` + `eq` from
// `f-rental-name-eq`.
//
// Multi-value ops (`in`, `btw`): first non-alphanumeric ASCII character
// of the value is the delimiter; `,` is the fallback when the leading char
// is alphanumeric. See the `first-char-delimiter-multivalue` topic.

const OPS = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in', 'btw', 'beg', 'ct', 'ex', 'nx']);
const MULTI_OPS = new Set(['in', 'btw']);
const NO_VALUE_OPS = new Set(['ex', 'nx']);

const ALNUM = /^[A-Za-z0-9]$/;

// Split a multi-value string per the first-char-delimiter rule.
// `"1,3,5"` → `[1, 3, 5]`; `"$1$3$5"` → `[1, 3, 5]`; `"^1^10"` → `[1, 10]`.
// Empty at boundary is dropped; empty in the interior is a malformed value
// — caller decides (we return empties; compiler rejects if unacceptable).
const splitMulti = value => {
  if (typeof value !== 'string' || value.length === 0) return [];
  const first = value[0];
  const delim = ALNUM.test(first) ? ',' : first;
  const parts = delim === ',' ? value.split(',') : value.slice(1).split(delim);
  // Drop leading / trailing empties; keep interior empties so the compiler
  // can distinguish delimiter-at-boundary from accidental double-delimiter.
  while (parts.length && parts[0] === '') parts.shift();
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
};

export const parseFFilter = query => {
  const clauses = [];
  if (!query || typeof query !== 'object') return clauses;
  for (const key of Object.keys(query)) {
    if (!key.startsWith('f-') || key.length < 6) continue; // min: `f-X-eq`
    // Split from the right: the trailing segment must match a closed op.
    const lastDash = key.lastIndexOf('-');
    if (lastDash <= 1) continue;
    const op = key.slice(lastDash + 1);
    if (!OPS.has(op)) continue;
    const field = key.slice(2, lastDash);
    if (field.length === 0) continue;
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    let values;
    if (NO_VALUE_OPS.has(op)) {
      values = [];
    } else if (MULTI_OPS.has(op)) {
      values = splitMulti(String(value ?? ''));
    } else {
      values = [String(value ?? '')];
    }
    clauses.push({field, op, values});
  }
  return clauses;
};
