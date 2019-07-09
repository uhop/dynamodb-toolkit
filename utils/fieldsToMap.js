'use strict';

const fieldsToMap = (fields, projectionFieldMap) => {
  if (!fields) return null;
  let fieldNames, fieldMap;
  if (typeof fields == 'string') {
    fieldNames = fields
      .split(',')
      .map(f => f.trim())
      .filter(f => f);
    fieldMap = fieldNames.reduce((acc, name) => ((acc[name] = 1), acc), {});
  } else {
    if (!projectionFieldMap) return fields;
    fieldNames = Object.keys(fields);
    fieldMap = fields;
  }
  if (!fieldNames.length) return null;
  return projectionFieldMap
    ? fieldNames
        .map(f => {
          const other = projectionFieldMap[f];
          return typeof other == 'string' ? other : f;
        })
        .reduce((acc, name) => ((acc[name] = 1), acc), {})
    : fieldMap;
};

module.exports = fieldsToMap;
