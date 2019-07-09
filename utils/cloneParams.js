'use strict';

const cloneParams = params => {
  params = Object.assign({}, params);
  params.ExpressionAttributeNames = Object.assign({}, params.ExpressionAttributeNames);
  params.ExpressionAttributeValues = Object.assign({}, params.ExpressionAttributeValues);
  return params;
};

module.exports = cloneParams;
