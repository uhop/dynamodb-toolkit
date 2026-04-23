// Build a FilterExpression for DynamoDB using searchable mirror columns.

import {normalizeFields} from '../paths/normalize-fields.js';

export const buildSearch = (searchable, query, options, params = {}) => {
  if (!query) return params;

  const fields = options?.fields;
  const prefix = options?.prefix || '-search-';
  const caseSensitive = options?.caseSensitive ?? false;

  let searchKeys = Object.keys(searchable);
  if (fields) {
    const normalized = normalizeFields(fields);
    if (normalized) {
      const fieldMap = normalized.reduce((acc, f) => ((acc[f] = 1), acc), {});
      searchKeys = searchKeys.filter(f => fieldMap[f] === 1);
    }
  }
  if (!searchKeys.length) return params;

  const offset = params.ExpressionAttributeNames ? Object.keys(params.ExpressionAttributeNames).length : 0;
  const filterExpr = searchKeys.map((_, index) => 'contains(#sr' + (offset + index) + ', :flt' + offset + ')').join(' OR ');

  if (params.FilterExpression) {
    params.FilterExpression = '(' + params.FilterExpression + ') AND (' + filterExpr + ')';
  } else {
    params.FilterExpression = filterExpr;
  }

  params.ExpressionAttributeNames = searchKeys.reduce((acc, value, index) => ((acc['#sr' + (offset + index)] = prefix + value), acc), {
    ...params.ExpressionAttributeNames
  });

  let value = query + '';
  if (!caseSensitive) value = value.toLowerCase();
  params.ExpressionAttributeValues = params.ExpressionAttributeValues || {};
  params.ExpressionAttributeValues[':flt' + offset] = value;

  return params;
};

// Build a FilterExpression from a partial example object (equality on each field).

export const buildFilterByExample = (example, params = {}) => {
  const keys = Object.keys(example);
  if (!keys.length) return params;

  const names = params.ExpressionAttributeNames || {};
  const values = params.ExpressionAttributeValues || {};
  let nameCounter = Object.keys(names).length;
  let valueCounter = Object.keys(values).length;

  const clauses = keys.map(key => {
    const nameAlias = '#fbe' + nameCounter++;
    const valueAlias = ':fbe' + valueCounter++;
    names[nameAlias] = key;
    values[valueAlias] = example[key];
    return nameAlias + ' = ' + valueAlias;
  });

  const expr = clauses.join(' AND ');
  if (params.FilterExpression) {
    params.FilterExpression = '(' + params.FilterExpression + ') AND (' + expr + ')';
  } else {
    params.FilterExpression = expr;
  }

  params.ExpressionAttributeNames = names;
  params.ExpressionAttributeValues = values;
  return params;
};
