'use strict';

// iteratively copy a list of items by keys

const readList = require('./readList');
const writeList = require('./writeList');

const copyListByKeys = require('./copyListByKeys');

const copyList = async (client, params, mapFn) => {
  let processed = 0;
  while(params) {
    params = await readList(client, params, async data => {
      if (data.Items.length) {
        processed += await writeList(client, params.TableName, data.Items, mapFn);
      }
    });
  }
  return processed;
};

copyList.viaKeys = async (client, params, mapFn) => {
  const tableName = params.TableName;
  let keys = [];
  while(params) {
    params = await readList(client, params, async data => (keys = keys.concat(data.Items)));
  }
  return copyList.byKeys(client, tableName, keys, mapFn);
};

copyList.byKeys = copyListByKeys;

module.exports = copyList;
