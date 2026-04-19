// Remove unused ExpressionAttributeNames and ExpressionAttributeValues from params.

const expressionFields = ['KeyConditionExpression', 'ConditionExpression', 'UpdateExpression', 'ProjectionExpression', 'FilterExpression'];

const escapeRE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isUsed = (params, key) => {
  const pattern = new RegExp(escapeRE(key) + '\\b');
  return expressionFields.some(f => params[f] && pattern.test(params[f]));
};

const cleanMap = (params, mapKey) => {
  const map = params[mapKey];
  if (!map) return;
  const keys = Object.keys(map);
  if (!keys.length) {
    delete params[mapKey];
    return;
  }
  const used = keys.filter(key => isUsed(params, key));
  if (!used.length) {
    delete params[mapKey];
  } else if (used.length < keys.length) {
    params[mapKey] = used.reduce((acc, key) => ((acc[key] = map[key]), acc), {});
  }
};

export const cleanParams = params => {
  cleanMap(params, 'ExpressionAttributeNames');
  cleanMap(params, 'ExpressionAttributeValues');
  return params;
};
