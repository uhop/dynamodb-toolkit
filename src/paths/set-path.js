// Set a value at a dotted path, creating intermediate objects as needed.

// Guard against prototype-pollution: user-supplied paths may contain '__proto__',
// 'constructor', or 'prototype'; refuse to walk or write through those.
const isUnsafeKey = key => key === '__proto__' || key === 'constructor' || key === 'prototype';

export const setPath = (o, path, value, separator = '.') => {
  if (typeof path === 'string') path = path.split(separator);
  const last = path.length - 1;
  for (let i = 0; i < last; ++i) {
    const part = path[i];
    if (isUnsafeKey(part)) return value;
    if (Object.hasOwn(o, part)) {
      const c = o[part];
      if (c && (typeof c === 'object' || typeof c === 'function')) {
        o = c;
        continue;
      }
    }
    o = o[part] = {};
  }
  if (isUnsafeKey(path[last])) return value;
  return (o[path[last]] = value);
};
