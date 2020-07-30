'use strict';

const setPath = require('./setPath');
const deletePath = require('./deletePath');

const applyPatch = (o, patch) => {
  const deleteProps = patch.__delete;
  Object.keys(patch).forEach(path => {
    if (path == '__delete') return;
    setPath(o, path, patch[path]);
  });
  deleteProps && deleteProps.forEach(path => deletePath(o, path));
  return o;
};

module.exports = applyPatch;
