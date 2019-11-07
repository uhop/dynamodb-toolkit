'use strict';

// iteratively copy a list of items by keys

'use strict';

const getBatch = require('./getBatch');

const readListByKeys = async (client, tableName, keys, generalParams) => {
  const result = await getBatch(client, keys.map(key => ({action: 'get', params: Object.assign({TableName: tableName, Key: key}, generalParams)})));
  return result.map(pair => pair.item);
};

module.exports = readListByKeys;