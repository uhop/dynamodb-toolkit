'use strict';

// "collect" routines work with a DB representation of the data

const collectValuesRecursively = (o, prefix, values) => {
  if (o.L) {
    o.L.forEach((item, index) => collectValuesRecursively(item, prefix.concat(index), values));
    return;
  }
  if (o.M) {
    Object.keys(o.M).forEach(key => collectValuesRecursively(o.M[key], prefix.concat(key), values));
    return;
  }
  values.push({path: prefix, value: o});
};

const collectValues = o => {
  const values = [];
  Object.keys(o).forEach(key => collectValuesRecursively(o[key], [key], values));
  return values;
};

// TODO: add ADD and DELETE for arrays

const prepareUpdate = (patch, params = {}) => {
  const setNames = {},
    uniqueNames = {},
    values = params.ExpressionAttributeValues || {};
  let keyCounter = 0,
    valueCounter = 0;
  const setActions = collectValues(patch).reduce((acc, item) => {
    const path = item.path.map(key => {
      if (typeof key == 'number') return key;
      let alias = uniqueNames['#' + key];
      if (!alias) {
        alias = uniqueNames['#' + key] = '#ups' + keyCounter++;
        setNames[alias] = key;
      }
      return alias;
    });
    const valueAlias = ':upv' + valueCounter++;
    values[valueAlias] = item.value;
    acc.push(path.join('.') + ' = ' + valueAlias);
    return acc;
  }, []);
  if (!setActions.length) return params;
  if (params.ExpressionAttributeNames) {
    Object.assign(params.ExpressionAttributeNames, setNames);
  } else {
    params.ExpressionAttributeNames = setNames;
  }
  params.ExpressionAttributeValues = values;
  params.UpdateExpression = 'SET ' + setActions.join(', ');
  return params;
};

const isInteger = /^\d+$/;

const prepareFlatUpdate = (patch, params = {}, separator = '.') => {
  const names = params.ExpressionAttributeNames || {},
    values = params.ExpressionAttributeValues || {},
    uniqueNames = {};
  let keyCounter = 0,
    valueCounter = 0;
  const setActions = Object.keys(patch).reduce((acc, key) => {
    if (key === '_delete') return acc;
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
  const removeActions = patch._delete && patch._delete.SS
    ? patch._delete.SS.reduce((acc, key) => {
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

prepareUpdate.flat = prepareFlatUpdate;

module.exports = prepareUpdate;
