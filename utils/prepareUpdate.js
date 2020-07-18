'use strict';

const isInteger = /^\d+$/;

const prepareUpdate = (patch, deleteProps, params = {}, separator = '.') => {
  const names = params.ExpressionAttributeNames || {},
    values = params.ExpressionAttributeValues || {},
    uniqueNames = {};
  let keyCounter = Object.keys(names).length,
    valueCounter = Object.keys(values).length;
  const setActions = Object.keys(patch).reduce((acc, key) => {
    const path = key.split(separator).map(key => {
      if (isInteger.test(key)) return key;
      let alias = uniqueNames['#' + key];
      if (!alias) {
        alias = uniqueNames['#' + key] = '#upk' + keyCounter++;
        names[alias] = key;
      }
      return alias;
    });
    const valueAlias = ':upv' + valueCounter++;
    values[valueAlias] = patch[key];
    acc.push(path.join('.') + ' = ' + valueAlias);
    return acc;
  }, []);
  const removeActions = deleteProps
    ? deleteProps.reduce((acc, key) => {
        const path = key.split(separator).map(key => {
          if (isInteger.test(key)) return key;
          let alias = uniqueNames['#' + key];
          if (!alias) {
            alias = uniqueNames['#' + key] = '#upk' + keyCounter++;
            names[alias] = key;
          }
          return alias;
        });
        acc.push(path.join('.'));
        return acc;
      }, [])
    : [];
  Object.keys(names).length && (params.ExpressionAttributeNames = names);
  params.UpdateExpression = removeActions.length ? 'REMOVE ' + removeActions.join(', ') : '';
  if (setActions.length) {
    params.ExpressionAttributeValues = values;
    params.UpdateExpression && (params.UpdateExpression += ' ');
    params.UpdateExpression += 'SET ' + setActions.join(', ');
  }
  return params;
};

module.exports = prepareUpdate;
