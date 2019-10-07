'use strict';

const cleanParams = params => {
  if (params.ExpressionAttributeNames) {
    const names = Object.keys(params.ExpressionAttributeNames);
    if (names.length) {
      const usedKeys = names.filter(key => {
        const pattern = new RegExp('\\b' + key + '\\b');
        return (
          (params.KeyConditionExpression && pattern.test(params.KeyConditionExpression)) ||
          (params.ConditionExpression && pattern.test(params.ConditionExpression)) ||
          (params.UpdateExpression && pattern.test(params.UpdateExpression)) ||
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
    } else {
      delete params.ExpressionAttributeNames;
    }
  }
  if (params.ExpressionAttributeValues) {
    const values = Object.keys(params.ExpressionAttributeValues);
    if (values.length) {
      const usedKeys = values.filter(key => {
        const pattern = new RegExp('\\b' + key + '\\b');
        return (
          (params.KeyConditionExpression && pattern.test(params.KeyConditionExpression)) ||
          (params.ConditionExpression && pattern.test(params.ConditionExpression)) ||
          (params.UpdateExpression && pattern.test(params.UpdateExpression)) ||
          (params.FilterExpression && pattern.test(params.FilterExpression))
        );
      });
      if (usedKeys.length) {
        params.ExpressionAttributeValues = usedKeys.reduce((acc, key) => {
          acc[key] = params.ExpressionAttributeValues[key];
          return acc;
        }, {});
      } else {
        delete params.ExpressionAttributeValues;
      }
    } else {
      delete params.ExpressionAttributeValues;
    }
  }
  return params;
};

module.exports = cleanParams;
