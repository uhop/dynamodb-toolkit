// Parse a `names` query value or request body into a string[]. Comma-separated string,
// JSON array body, or already-an-array all accepted. Empty / missing → [].
// Output length capped at `options.maxItems` (default 1000) to prevent DoS via
// unbounded key counts — BatchGetItem limit is 100 per call anyway, so 1000 is generous.

export const parseNames = (input, options = {}) => {
  if (input == null || input === '') return [];
  const maxItems = options.maxItems ?? 1000;
  const raw = Array.isArray(input)
    ? input.map(s => String(s).trim()).filter(Boolean)
    : String(input)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
  return raw.length > maxItems ? raw.slice(0, maxItems) : raw;
};
