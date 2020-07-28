'use strict';

// iteratively copy a list of items by params

const readList = require('./readList');
const writeList = require('./writeList');

const copyListByKeys = require('./copyListByKeys');

const identity = x => x;

const copyList = async (client, params) => {
  const tableName = params.TableName;
  let processed = 0;
  while(params) {
    params = await readList(client, params, async data => {
      const items = data.Items;
      for (let offset = 0; offset < items.length; offset += 25) {
        const slice = items.slice(offset, offset + 25);
        processed += await writeList(client, tableName, slice, mapFn);
      }
    });
  }
  return processed;
};

copyList.viaKeys = async (client, params, mapFn, keyFn = identity) => {
  const tableName = params.TableName;
  let keys = [];
  while(params) {
    params = await readList(client, params, async data => (keys = keys.concat(data.Items.map(keyFn).filter(identity))));
  }
  return copyList.byKeys(client, tableName, keys, mapFn);
};

copyList.byKeys = copyListByKeys;

module.exports = copyList;
