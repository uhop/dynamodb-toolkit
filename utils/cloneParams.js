'use strict';

const cloneParams = params => {
  params = {...params};
  params.ExpressionAttributeNames = {...params.ExpressionAttributeNames};
  params.ExpressionAttributeValues = {...params.ExpressionAttributeValues};
  return params;
};

module.exports = cloneParams;
