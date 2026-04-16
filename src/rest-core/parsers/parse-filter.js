// Parse a `filter` query value into {query, mode?}. Mode defaults are caller's call.

export const parseFilter = (input, options = {}) => {
  if (input == null || input === '') return null;
  const query = Array.isArray(input) ? input.join(' ') : String(input);
  if (!query.trim()) return null;
  const out = {query};
  if (options.mode) out.mode = options.mode;
  if (typeof options.caseSensitive === 'boolean') out.caseSensitive = options.caseSensitive;
  return out;
};
