// Parse a `names` query value or request body into a string[]. Comma-separated string,
// JSON array body, or already-an-array all accepted. Empty / missing → [].

export const parseNames = input => {
  if (input == null || input === '') return [];
  if (Array.isArray(input)) {
    return input.map(s => String(s).trim()).filter(Boolean);
  }
  return String(input)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
};
