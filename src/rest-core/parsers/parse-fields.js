// Parse a `fields` query value: 'name,climate' or ['name', 'climate'] → string[] | null.
// Returns null when input is missing/empty (caller should not project).
// Output length capped at `options.maxItems` (default 1000) to prevent DoS via
// unbounded field counts — DynamoDB rejects at ~4KB expression size anyway.

const truncate = (arr, maxItems) => (arr.length > maxItems ? arr.slice(0, maxItems) : arr);

export const parseFields = (input, options = {}) => {
  if (input == null || input === '') return null;
  const maxItems = options.maxItems ?? 1000;
  if (Array.isArray(input)) {
    const out = input.map(s => String(s).trim()).filter(Boolean);
    return out.length ? truncate(out, maxItems) : null;
  }
  const out = String(input)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return out.length ? truncate(out, maxItems) : null;
};
