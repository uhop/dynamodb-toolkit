'use strict';

// deal with the DynamoDB data representation

const convertValueFromDynamoDB = value => {
  const types = Object.keys(value);
  switch (types[0]) {
    case 'N':
      return +value.N;
    case 'NULL':
      return null;
    case 'NS':
      return value.NS.map(value => +value);
    case 'L':
      return value.L.map(value => convertValueFromDynamoDB(value));
    case 'M':
      return Object.keys(value.M).reduce((acc, key) => ((acc[key] = convertValueFromDynamoDB(value.M[key])), acc), {});
    default:
      return value[types[0]];
  }
};

const convertFrom = item => Object.keys(item).reduce((acc, key) => ((acc[key] = convertValueFromDynamoDB(item[key])), acc), {});

const convertValueToDynamoDB = value => {
  switch (typeof value) {
    case 'string':
      return value ? {S: value} : {NULL: true};
    case 'number':
      return {N: '' + value};
    case 'boolean':
      return {BOOL: value};
    case 'undefined':
      return; // undefined
  }
  if (value instanceof Array) {
    return {L: value.map(convertValueToDynamoDB)};
  }
  if (value === null) {
    return {NULL: true};
  }
  if (typeof value == 'object') {
    return {
      M: Object.keys(value).reduce((acc, key) => {
        acc[key] = convertValueToDynamoDB(value[key]);
        return acc;
      }, {})
    };
  }
  const v = '' + value;
  return v ? {S: v} : {NULL: true};
};

const convertTo = (item, useType = {}) => {
  if (item && typeof item == 'object' && !(item instanceof Array)) {
    return Object.keys(item).reduce((acc, key) => {
      switch (useType[key]) {
        case 'SS':
          acc[key] = {SS: item[key]};
          break;
        case 'NS':
          acc[key] = {NS: item[key].map(value => '' + value)};
          break;
        default:
          const value = convertValueToDynamoDB(item[key]);
          if (value) {
            acc[key] = value;
          }
          break;
      }
      return acc;
    }, {});
  }
  return convertValueToDynamoDB(item);
};

module.exports.convertValueFromDynamoDB = convertValueFromDynamoDB;
module.exports.convertValueToDynamoDB = convertValueToDynamoDB;

module.exports.convertFrom = convertFrom;
module.exports.convertTo = convertTo;
