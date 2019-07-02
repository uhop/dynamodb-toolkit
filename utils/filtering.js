'use strict';

const filtering = (filter, fieldMap, searchable, params = {}) => {
  if (!filter) return params;

  let searchKeys = Object.keys(searchable);
  if (fieldMap) {
    searchKeys = searchKeys.filter(f => fieldMap[f] === 1);
  }

  if (!searchKeys.length) return params;

  const filterExpr = searchKeys.map((_, index) => 'contains(#sr' + index + ', :filter)').join(' OR ');
  if (params.FilterExpression) {
    params.FilterExpression = '(' + params.FilterExpression + ') AND (' + filterExpr + ')';
  } else {
    params.FilterExpression = filterExpr;
  }

  params.ExpressionAttributeNames = searchKeys.reduce(
    (acc, value, index) => ((acc['#sr' + index] = '-search-' + value), acc),
    params.ExpressionAttributeNames ? Object.assign({}, params.ExpressionAttributeNames) : {}
  );

  params.ExpressionAttributeValues = params.ExpressionAttributeValues || {};
  params.ExpressionAttributeValues[':filter'] = {S: (filter + '').toLowerCase()};

  return params;
};

module.exports = filtering;
