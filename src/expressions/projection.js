// Build a ProjectionExpression for DynamoDB, handling de-duplication and attribute aliasing.

import {normalizeFields} from '../paths/normalize-fields.js';

const isInteger = /^\d+$/;

const removeDups =
  (dict = {}) =>
  key => {
    if (dict[key] === 1) return false;
    dict[key] = 1;
    return true;
  };

export const addProjection = (params, fields, projectionFieldMap, skipSelect, separator = '.') => {
  if (!fields) return params;
  fields = normalizeFields(fields, projectionFieldMap);
  if (!fields) return params;

  const names = params.ExpressionAttributeNames || {},
    keys = Object.keys(names),
    reversedNames = keys.reduce((acc, key) => ((acc['#' + names[key]] = key), acc), {}),
    uniqueNames = {};
  let keyCounter = keys.length;

  const projection = fields
    .filter(removeDups())
    .reduce((acc, key) => {
      const path = key.split(separator).map(part => {
        if (isInteger.test(part)) return part;
        let alias = uniqueNames['#' + part] || reversedNames['#' + part];
        if (!alias) {
          alias = uniqueNames['#' + part] = '#pj' + keyCounter++;
          names[alias] = part;
        }
        return alias;
      });
      acc.push(path.reduce((acc, part) => acc + (acc ? (isInteger.test(part) ? '[' + part + ']' : '.' + part) : part), ''));
      return acc;
    }, [])
    .join(',');

  if (projection) {
    if (Object.keys(names).length) params.ExpressionAttributeNames = names;
    if (params.ProjectionExpression) {
      params.ProjectionExpression += ',' + projection;
    } else {
      params.ProjectionExpression = projection;
    }
    if (!skipSelect && params.ProjectionExpression) params.Select = 'SPECIFIC_ATTRIBUTES';
  }
  if (params.ProjectionExpression) {
    params.ProjectionExpression = params.ProjectionExpression.split(',')
      .map(s => s.trim())
      .filter(removeDups())
      .join(',');
  }
  return params;
};
