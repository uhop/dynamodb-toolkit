'use strict';

const combineParams = (a, b) => {
  const t = {...a, ...b};
  if (a.ExpressionAttributeNames && b.ExpressionAttributeNames) {
    t.ExpressionAttributeNames = {...a.ExpressionAttributeNames, ...b.ExpressionAttributeNames};
  }
  if (a.ExpressionAttributeValues && b.ExpressionAttributeValues) {
    t.ExpressionAttributeValues = {...a.ExpressionAttributeValues, ...b.ExpressionAttributeValues};
  }
  return t;
};

module.exports = combineParams;
