// Traverse an object by a dotted path, returning the value or a default.

export const getPath = (o, path, defaultValue, separator = '.') => {
  if (typeof path === 'string') path = path.split(separator);
  for (let i = 0; i < path.length; ++i) {
    if (!o || (typeof o !== 'object' && typeof o !== 'function')) return defaultValue;
    o = o[path[i]];
  }
  return o === undefined ? defaultValue : o;
};
