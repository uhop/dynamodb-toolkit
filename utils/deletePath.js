'use strict';

const deletePath = (o, path, separator = '.') => {
  if (typeof path == 'string') path = path.split(separator);
  for (let i = 0; i < path.length - 1; ++i) {
    const part = path[i];
    if (o.hasOwnProperty(part)) {
      o = o[part];
    } else {
      return false;
    }
  }
  return delete o[path[path.length - 1]];
};

module.exports = deletePath;
