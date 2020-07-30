'use strict';

const setPath = require('./setPath');
const deletePath = require('./deletePath');

const applyPatch = (o, patch) => {
  Object.keys(patch).forEach(path => {
    if (path == '__delete') {
      patch.__delete.forEach(path => deletePath(o, path));
    } else {
      setPath(o, path, patch[path]);
    }
  });
  return o;
};

module.exports = applyPatch;
