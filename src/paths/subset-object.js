// Return a new object containing only the fields at the specified paths.

import {normalizeFields} from './normalize-fields.js';
import {getPath} from './get-path.js';
import {setPath} from './set-path.js';

const NONE = {};

export const subsetObject = (o, fields, separator = '.') => {
  fields = normalizeFields(fields);
  if (!fields) return o;
  return fields.reduce((acc, path) => {
    const value = getPath(o, path, NONE, separator);
    if (value !== NONE) setPath(acc, path, value, separator);
    return acc;
  }, {});
};
