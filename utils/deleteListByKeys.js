'use strict';

// iteratively delete a list of items by keys

const applyBatch = require('./applyBatch');

const deleteListByKeys = async (client, tableName, keys) => {
  return applyBatch(client, keys.filter(key => key).map(key => ({action: 'delete', params: {TableName: tableName, Key: key}})));
};

module.exports = deleteListByKeys;
