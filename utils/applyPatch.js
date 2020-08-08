'use strict';

const setPath = require('./setPath');
const deletePath = require('./deletePath');

const applyPatch = (o, patch, separator = '.') => {
  Object.keys(patch).forEach(path => {
    if (path == '__delete') {
      patch.__delete.forEach(path => deletePath(o, path, separator));
    } else {
      setPath(o, path, patch[path], separator);
    }
  });
  return o;
};

module.exports = applyPatch;
