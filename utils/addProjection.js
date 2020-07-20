'use strict';

const normalizeFields = require('./normalizeFields');

// form a project expression for DynamoDB

const isInteger = /^\d+$/;

const addProjection = (params, fields, projectionFieldMap, skipSelect, separator = '.') => {
  if (!fields) return params;
  fields = normalizeFields(fields, projectionFieldMap);
  if (!fields) return params;
  const names = params.ExpressionAttributeNames || {},
    uniqueNames = {};
  let keyCounter = Object.keys(names).length;
  const projection = fields
    .reduce((acc, key) => {
      const path = key.split(separator).map(key => {
        if (isInteger.test(key)) return key;
        let alias = uniqueNames['#' + key];
        if (!alias) {
          alias = uniqueNames['#' + key] = '#pj' + keyCounter++;
          names[alias] = key;
        }
        return alias;
      });
      acc.push(path.reduce((acc, part) => acc + (acc ? (isInteger.test(part) ? '[' + part + ']' : '.' + part) : part), ''));
      return acc;
    }, [])
    .join(', ');
  if (projection) {
    Object.keys(names).length && (params.ExpressionAttributeNames = names);
    if (params.ProjectionExpression) {
      params.ProjectionExpression += ',' + projection;
    } else {
      params.ProjectionExpression = projection;
    }
    !skipSelect && params.ProjectionExpression && (params.Select = 'SPECIFIC_ATTRIBUTES');
  }
  return params;
};

module.exports = addProjection;
