'use strict';

const fieldsToMap = require('./fieldsToMap');

// form a project expression for DynamoDB

const addProjection = (params, fields, projectionFieldMap, skipSelect) => {
  if (!fields) return params;
  fields = fieldsToMap(fields, projectionFieldMap);
  const projectionMap = fields.reduce((acc, value, index) => ((acc['#pr' + index] = value), acc), {});
  const names = Object.keys(projectionMap);
  if (params.ExpressionAttributeNames) {
    Object.assign(params.ExpressionAttributeNames, projectionMap);
  } else {
    params.ExpressionAttributeNames = projectionMap;
  }
  params.ProjectionExpression = names.join(', ');
  !skipSelect && (params.Select = 'SPECIFIC_ATTRIBUTES');
  return params;
};

module.exports = addProjection;
