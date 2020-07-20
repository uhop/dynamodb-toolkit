'use strict';

const normalizeFields = require('./normalizeFields');
const getPath = require('./getPath');
const setPath = require('./setPath');

const NONE = {};

const subsetObject = (o, fields) => {
  fields = normalizeFields(fields);
  if (!fields) return o;
  return fields.reduce((acc, path) => {
    const value = getPath(o, path, NONE);
    if (value !== NONE) setPath(acc, path, value);
    return acc;
  }, {});
};

module.exports = subsetObject;
