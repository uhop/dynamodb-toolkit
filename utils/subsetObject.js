'use strict';

const normalizeFields = require('./normalizeFields');
const getPath = require('./getPath');
const setPath = require('./setPath');

const NONE = {};

const subsetObject = (o, fields, separator = '.') => {
  fields = normalizeFields(fields);
  if (!fields) return o;
  return fields.reduce((acc, path) => {
    const value = getPath(o, path, NONE, separator);
    if (value !== NONE) setPath(acc, path, value, separator);
    return acc;
  }, {});
};

module.exports = subsetObject;
