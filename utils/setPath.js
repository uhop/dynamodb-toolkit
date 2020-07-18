'use strict';

const setPath = (o, path, value, separator = '.') => {
  if (typeof path == 'string') path = path.split(separator);
  for (let i = 0; i < path.length - 1; ++i) {
    const part = path[i];
    if (o.hasOwnProperty(part)) {
      o = o[part];
    } else {
      o = o[part] = {};
    }
  }
  return (o[path[path.length - 1]] = value);
};

module.exports = setPath;
