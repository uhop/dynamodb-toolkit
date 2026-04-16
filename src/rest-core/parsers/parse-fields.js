// Parse a `fields` query value: 'name,climate' or ['name', 'climate'] → string[] | null.
// Returns null when input is missing/empty (caller should not project).

export const parseFields = input => {
  if (input == null || input === '') return null;
  if (Array.isArray(input)) {
    const out = input.map(s => String(s).trim()).filter(Boolean);
    return out.length ? out : null;
  }
  const out = String(input)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return out.length ? out : null;
};
