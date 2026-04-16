// Delete a value at a dotted path. Returns true if deletion occurred, false otherwise.

export const deletePath = (o, path, separator = '.') => {
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
    return false;
  }
  return delete o[path[last]];
};
