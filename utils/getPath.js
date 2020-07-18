'use strict';

const getPath = (o, path, defaultValue, separator = '.') => {
  if (typeof path == 'string') path = path.split(separator);
  for (let i = 0; i < path.length; ++i) {
    if (!o || (typeof o != 'object' && typeof o != 'function')) return defaultValue;
    o = o[path[i]];
  }
  return o;
};

module.exports = getPath;
