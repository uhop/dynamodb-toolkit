'use strict';

const filtering = (filter, fieldMap, searchable, prefix = '-search-', params = {}) => {
  if (!filter) return params;

  let searchKeys = Object.keys(searchable);
  if (fieldMap) {
    searchKeys = searchKeys.filter(f => fieldMap[f] === 1);
  }

  if (!searchKeys.length) return params;

  const offset = params.ExpressionAttributeNames ? Object.keys(params.ExpressionAttributeNames).length : 0,
    filterExpr = searchKeys.map((_, index) => 'contains(#sr' + (offset + index) + ', :flt' + offset + ')').join(' OR ');
  if (params.FilterExpression) {
    params.FilterExpression = '(' + params.FilterExpression + ') AND (' + filterExpr + ')';
  } else {
    params.FilterExpression = filterExpr;
  }

  params.ExpressionAttributeNames = searchKeys.reduce(
    (acc, value, index) => ((acc['#sr' + (offset + index)] = prefix + value), acc),
    params.ExpressionAttributeNames ? Object.assign({}, params.ExpressionAttributeNames) : {}
  );

  params.ExpressionAttributeValues = params.ExpressionAttributeValues || {};
  params.ExpressionAttributeValues[':flt' + offset] = {S: (filter + '').toLowerCase()};

  return params;
};

module.exports = filtering;
