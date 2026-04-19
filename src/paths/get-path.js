// Traverse an object by a dotted path, returning the value or a default.
// Walks own enumerable properties only — inherited prototype-chain values
// resolve to `defaultValue` rather than leaking inherited methods / fields.

export const getPath = (o, path, defaultValue, separator = '.') => {
  if (typeof path === 'string') path = path.split(separator);
  for (let i = 0; i < path.length; ++i) {
    if (!o || (typeof o !== 'object' && typeof o !== 'function')) return defaultValue;
    if (!Object.hasOwn(o, path[i])) return defaultValue;
    o = o[path[i]];
  }
  return o === undefined ? defaultValue : o;
};
