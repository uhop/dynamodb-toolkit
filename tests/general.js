'use strict';

const AWS = require('aws-sdk');

const dbd = new AWS.DynamoDB();

const Adapter = require('../src/Adapter');

const contentAdapter = new Adapter({
  client: dbd,
  table: 'test',
  keyFields: ['id', 'key'],
  specialTypes: {_delete: 'SS'},
  prepareMap: {},
  makeKey(item) {
    return {id: item.domain, key: item.name};
  }
});

const object1 = contentAdapter.getByKey(key, fields = '');
