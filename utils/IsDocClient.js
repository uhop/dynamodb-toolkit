'use strict';

const AWS = require('aws-sdk');

const DocumentClient = AWS.DynamoDB.DocumentClient;

const isDocClient = client => client instanceof DocumentClient;

module.exports = isDocClient;
