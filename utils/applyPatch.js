'use strict';

const setPath = require('./setPath');
const deletePath = require('./deletePath');

const applyPatch = (o, patch, separator = '.') => {
  if (patch.__separator && typeof patch.__separator == 'string') {
    separator = patch.__separator;
  }
  Object.keys(patch).forEach(path => {
    switch (path) {
      case '__separator':
        break;
      case '__delete':
        patch.__delete.forEach(path => deletePath(o, path, separator));
        break;
      default:
        setPath(o, path, patch[path], separator);
        break;
    }
  });
  return o;
};

module.exports = applyPatch;
