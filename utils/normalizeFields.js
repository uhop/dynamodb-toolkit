'use strict';

const normalizeFields = (fields, projectionFieldMap, separator = '.') => {
  if (!fields) return null;
  if (!Array.isArray(fields)) {
    if (typeof fields == 'string') {
      fields = fields
        .split(',')
        .map(f => f.trim())
        .filter(f => f);
    } else if (typeof fields == 'object') {
      fields = Object.keys(fields);
    } else {
      return null;
    }
  }
  if (!projectionFieldMap) return fields;
  return fields.map(name => {
    const parts = name.split(separator),
      replacement = projectionFieldMap[parts[0]];
    if (typeof replacement == 'string') {
      parts[0] = replacement;
      return parts.join(separator);
    }
    return name;
  });
};

module.exports = normalizeFields;
