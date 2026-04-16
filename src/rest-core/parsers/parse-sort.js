// Parse a `sort` query value: '-name' or 'name' → {field, direction}.
// Leading '-' means descending. Empty/missing input → null.
// Multi-field input ('name,-other') returns the first; the chain field
// retains the rest for callers that support multi-key sort.

export const parseSort = input => {
  if (input == null || input === '') return null;
  const raw = Array.isArray(input) ? input.join(',') : String(input);
  const parts = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const all = parts.map(p => {
    if (p.startsWith('-')) return {field: p.slice(1), direction: 'desc'};
    return {field: p, direction: 'asc'};
  });
  return {field: all[0].field, direction: all[0].direction, chain: all};
};
