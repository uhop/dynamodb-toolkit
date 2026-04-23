// Parse `<op>-<field>=<value>` query parameters into a structured clause
// list. Pure shape extraction — no type coercion, no allowlist check. The
// adapter's `applyFilter` compiles these clauses into FilterExpression /
// KeyConditionExpression using its declared `filterable` allowlist +
// keyFields / indices metadata.
//
// Grammar: the key starts with a registered op token followed by `-`, then
// the field name (which may itself contain dashes — `eq-rental-name` →
// op `eq`, field `rental-name`).
//
// Multi-value ops (`in`, `btw`): first non-alphanumeric ASCII character
// of the value is the delimiter; `,` is the fallback when the leading char
// is alphanumeric. See the `first-char-delimiter-multivalue` topic.

const OP_PREFIX = /^(eq|ne|lt|le|gt|ge|in|btw|beg|ct|ex|nx)-(.+)$/;
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
  while (parts.length && parts[0] === '') parts.shift();
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
};

export const parseFilter = query => {
  const clauses = [];
  if (!query || typeof query !== 'object') return clauses;
  for (const key of Object.keys(query)) {
    const m = OP_PREFIX.exec(key);
    if (!m) continue;
    const op = m[1];
    const field = m[2];
    if (field.length === 0) continue;
    const raw = query[key];
    const rawValue = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    const clause = {field, op};
    if (NO_VALUE_OPS.has(op)) {
      // no-value ops omit `value` entirely (additive-presence shape)
    } else if (MULTI_OPS.has(op)) {
      clause.value = splitMulti(String(rawValue ?? ''));
    } else {
      clause.value = String(rawValue ?? '');
    }
    clauses.push(clause);
  }
  return clauses;
};
