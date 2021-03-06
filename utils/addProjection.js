'use strict';

const normalizeFields = require('./normalizeFields');

// form a project expression for DynamoDB

const isInteger = /^\d+$/;

const removeDups = (dict = {}) => key => {
  if (dict[key] === 1) return false;
  dict[key] = 1;
  return true;
};

const addProjection = (params, fields, projectionFieldMap, skipSelect, separator = '.') => {
  if (!fields) return params;
  fields = normalizeFields(fields, projectionFieldMap);
  if (!fields) return params;
  const names = params.ExpressionAttributeNames || {},
    keys = Object.keys(names),
    reversedNames = keys.reduce((acc, key) => ((acc['#' + names[key]] = key), acc), {}),
    uniqueNames = {};
  let keyCounter = Object.keys(names).length;
  const projection = fields
    .filter(removeDups())
    .reduce((acc, key) => {
      const path = key.split(separator).map(key => {
        if (isInteger.test(key)) return key;
        let alias = uniqueNames['#' + key] || reversedNames['#' + key];
        if (!alias) {
          alias = uniqueNames['#' + key] = '#pj' + keyCounter++;
          names[alias] = key;
        }
        return alias;
      });
      acc.push(path.reduce((acc, part) => acc + (acc ? (isInteger.test(part) ? '[' + part + ']' : '.' + part) : part), ''));
      return acc;
    }, [])
    .join(',');
  if (projection) {
    Object.keys(names).length && (params.ExpressionAttributeNames = names);
    if (params.ProjectionExpression) {
      params.ProjectionExpression += ',' + projection;
    } else {
      params.ProjectionExpression = projection;
    }
    !skipSelect && params.ProjectionExpression && (params.Select = 'SPECIFIC_ATTRIBUTES');
  }
  if (params.ProjectionExpression) {
    params.ProjectionExpression = params.ProjectionExpression.split(/\s*,\s*/).filter(removeDups()).join(',');
  }
  return params;
};

module.exports = addProjection;
