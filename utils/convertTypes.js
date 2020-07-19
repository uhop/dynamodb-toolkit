'use strict';

const getPath = require('./getPath');
const setPath = require('./setPath');

const defaultOptions = {convertEmptyValues: false, wrapNumbers: false};

// deal with the DynamoDB data representation

const setDynamoPath = (o, path, value, separator = '.') => {
  if (typeof path == 'string') path = path.split(separator);
  let type = 'M';
  for (let i = 0; i < path.length - 1; ++i) {
    const part = path[i];
    if (!o.hasOwnProperty(part)) return;
    o = o[part];
    o = o.M || o.L;
  }
  return (o[path[path.length - 1]] = value);
};

const convertFrom = (converter, item, useType) => {
  const result = converter.unmarshall(item, defaultOptions);
  if (!useType) return result;
  Object.keys(useType).forEach(name => {
    const names = name.split('.'),
      value = getPath(result, names);
    switch (useType[name]) {
      case 'NS':
        value &&
          value.values &&
          setPath(
            o,
            names,
            Array.from(value.values).map(x => +x)
          );
        break;
      case 'SS':
      case 'BS':
        value && value.values && setPath(o, names, Array.from(value.values));
        break;
    }
  });
  return result;
};

const convertTo = (converter, item, useType) => {
  const result = converter.marshall(item, defaultOptions);
  if (!useType) return result;
  Object.keys(useType).forEach(name => {
    const names = name.split('.'),
      value = getPath(item, names);
    if (!(value instanceof Array)) return;
    switch (useType[name]) {
      case 'NS':
        setDynamoPath(result, names, {NS: value.map(x => '' + x)});
        break;
      case 'SS':
      case 'BS':
        setDynamoPath(result, names, {[useType[name]]: [...value]});
        break;
    }
  });
  return result;
};

module.exports.convertFrom = convertFrom;
module.exports.convertTo = convertTo;
