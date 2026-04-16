// Set a value at a dotted path, creating intermediate objects as needed.

export const setPath = (o, path, value, separator = '.') => {
  if (typeof path === 'string') path = path.split(separator);
  const last = path.length - 1;
  for (let i = 0; i < last; ++i) {
    const part = path[i];
    if (Object.hasOwn(o, part)) {
      const c = o[part];
      if (c && (typeof c === 'object' || typeof c === 'function')) {
        o = c;
        continue;
      }
    }
    o = o[part] = {};
  }
  return (o[path[last]] = value);
};
