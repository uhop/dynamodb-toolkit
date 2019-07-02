'use strict';

const fieldsToMap = fields => {
  if (!fields) return null;
  const fieldNames = fields.split(',').map(f => f.trim());
  if (!fieldNames.length) return null;
  return fieldNames.reduce((acc, name) => ((acc[name] = 1), acc), {});
};

module.exports = fieldsToMap;
