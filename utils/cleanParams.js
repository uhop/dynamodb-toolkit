'use strict';

const cleanParams = params => {
  if (params.ExpressionAttributeNames) {
    const usedKeys = Object.keys(params.ExpressionAttributeNames).filter(key => {
      const pattern = new RegExp(key + '\\b');
      return (
        (params.KeyConditionExpression && pattern.test(params.KeyConditionExpression)) ||
        (params.ProjectionExpression && pattern.test(params.ProjectionExpression)) ||
        (params.FilterExpression && pattern.test(params.FilterExpression))
      );
    });
    if (usedKeys.length) {
      params.ExpressionAttributeNames = usedKeys.reduce((acc, key) => {
        acc[key] = params.ExpressionAttributeNames[key];
        return acc;
      }, {});
    } else {
      delete params.ExpressionAttributeNames;
    }
  }
  return params;
};

module.exports = cleanParams;
