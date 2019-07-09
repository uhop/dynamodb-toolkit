'use strict';

const fieldsToMap = require('./fieldsToMap');

// form a project expression for DynamoDB

const addProjection = (params, fields, projectionFieldMap, skipSelect) => {
  if (!fields) return params;
  fields = fieldsToMap(fields, projectionFieldMap);
  if (!fields) return params;
  const offset = params.ExpressionAttributeNames ? Object.keys(params.ExpressionAttributeNames).length : 0,
    projectionMap = Object.keys(fields).reduce((acc, name, index) => ((acc['#pr' + (offset + index)] = name), acc), {});
  if (offset) {
    Object.assign(params.ExpressionAttributeNames, projectionMap);
  } else {
    params.ExpressionAttributeNames = projectionMap;
  }
  const names = Object.keys(projectionMap).join(',');
  if (params.ProjectionExpression) {
    params.ProjectionExpression += ',' + names;
  } else {
    params.ProjectionExpression = names;
  }
  !skipSelect && (params.Select = 'SPECIFIC_ATTRIBUTES');
  return params;
};

module.exports = addProjection;
