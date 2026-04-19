// Delete a value at a dotted path. Returns true if deletion occurred, false otherwise.

// Guard against prototype-pollution: refuse to walk or delete through '__proto__',
// 'constructor', or 'prototype' segments in a user-supplied path.
const isUnsafeKey = key => key === '__proto__' || key === 'constructor' || key === 'prototype';

export const deletePath = (o, path, separator = '.') => {
  if (typeof path === 'string') path = path.split(separator);
  const last = path.length - 1;
  for (let i = 0; i < last; ++i) {
    const part = path[i];
    if (isUnsafeKey(part)) return false;
    if (Object.hasOwn(o, part)) {
      const c = o[part];
      if (c && (typeof c === 'object' || typeof c === 'function')) {
        o = c;
        continue;
      }
    }
    return false;
  }
  if (isUnsafeKey(path[last])) return false;
  return delete o[path[last]];
};
