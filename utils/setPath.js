'use strict';

const setPath = (o, path, value, separator = '.') => {
  if (typeof path == 'string') path = path.split(separator);
  const last = path.length - 1;
  for (let i = 0; i < last; ++i) {
    const part = path[i];
    if (o.hasOwnProperty(part)) {
      const c = o[part];
      if (c && (typeof c == 'object' || typeof c == 'function')) {
        o = c;
        continue;
      }
    }
    o = o[part] = {};
  }
  return (o[path[last]] = value);
};

module.exports = setPath;
