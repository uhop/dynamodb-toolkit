'use strict';

// deal with the DynamoDB data representation, implements a version of AWS.DynamoDB.Converter

const Converter = {
  input: (data, options) => {
    const convertEmptyValues = options && options.convertEmptyValues;
    switch (typeof data) {
      case 'string':
        return data || !convertEmptyValues ? {S: data} : {NULL: true};
      case 'number':
        return {N: '' + data};
      case 'boolean':
        return {BOOL: data};
      case 'undefined':
        return; // undefined
    }
    if (data === null) {
      return {NULL: true};
    }
    if (data instanceof Array) {
      return data.length || !convertEmptyValues ? {L: data.map(value => Converter.input(value, options))} : {NULL: true};
    }
    if (data instanceof Set) {
      const array = Array.from(data.values());
      // an empty set will be coded as NULL because we cannot determine its type
      if (!array.length) return {NULL: true};
      // we will use only the first element to make a decision on type
      if (typeof array[0] == 'number') {
        return {NS: array.map(n => '' + n)};
      }
      if (typeof array[0] == 'string') {
        return {SS: array};
      }
      if (array[0] instanceof Buffer) {
        return {BS: array};
      }
      throw Error('Unsupported type of Set');
    }
    if (data instanceof Buffer) {
      return data.length || !convertEmptyValues ? {B: data} : {NULL: true};
    }
    if (typeof data == 'object') {
      return {
        M: Object.keys(data).reduce((acc, key) => {
          acc[key] = Converter.input(data[key], options);
          return acc;
        }, {})
      };
    }
    const v = '' + data;
    return v ? {S: v} : {NULL: true};
  },

  output: (data, options) => {
    const useArraysForSets = options && options.useArraysForSets,
      types = Object.keys(data);
    switch (types[0]) {
      case 'N':
        return +data.N;
      case 'NULL':
        return null;
      case 'L':
        return data.L.map(data => Converter.output(data, options));
      case 'M':
        return Object.keys(data.M).reduce((acc, key) => ((acc[key] = Converter.output(data.M[key], options)), acc), {});
      case 'NS': {
        const array = data.NS.map(n => +n);
        return useArraysForSets ? array: new Set(array);
      }
      case 'BS':
      case 'SS': {
        const array = data[types[0]];
        return useArraysForSets ? array : new Set(array);
      }
      default:
        return data[types[0]];
    }
  },

  marshall: (data, options) => Converter.input(data, options).M,

  unmarshall: (data, options) => Converter.output({M: data}, options)
};

module.exports = Converter;
