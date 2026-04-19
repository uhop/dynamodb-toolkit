// Parse a `filter` query value into {query, mode?}. Mode defaults are caller's call.
// Query truncated to `options.maxLength` chars (default 1024) to bound CPU work
// during casefold / downstream expression building.

export const parseFilter = (input, options = {}) => {
  if (input == null || input === '') return null;
  const maxLength = options.maxLength ?? 1024;
  let query = Array.isArray(input) ? input.join(' ') : String(input);
  if (!query.trim()) return null;
  if (query.length > maxLength) query = query.slice(0, maxLength);
  const out = {query};
  if (options.mode) out.mode = options.mode;
  if (typeof options.caseSensitive === 'boolean') out.caseSensitive = options.caseSensitive;
  return out;
};
