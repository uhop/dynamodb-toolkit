'use strict';

// iteratively move a list of items by params

const readList = require('./readList');
const applyBatch = require('./applyBatch');

const moveListByKeys = require('./moveListByKeys');

const identity = x => x;

const moveList = async (client, params, mapFn, keyFn = identity) => {
  const tableName = params.TableName;
  let processed = 0;
  while (params) {
    params = await readList(client, params, async data => {
      const items = data.Items;
      for (let offset = 0; offset < items.length; offset += 12) {
        const slice = items.slice(offset, offset + 12);
        processed += await applyBatch(client, [
          ...slice
            .map(mapFn)
            .filter(identity)
            .map(item => ({action: 'put', params: {TableName: tableName, Item: item}})),
          ...slice
            .map(keyFn)
            .filter(identity)
            .map(key => ({action: 'delete', params: {TableName: tableName, Key: key}}))
        ]);
      }
    });
  }
  return processed;
};

moveList.viaKeys = async (client, params, mapFn, keyFn = identity) => {
  let keys = [];
  while (params) {
    params = await readList(client, params, async data => (keys = keys.concat(data.Items.map(keyFn).filter(identity))));
  }
  return moveList.byKeys(client, params.TableName, keys, mapFn);
};

moveList.byKeys = moveListByKeys;

module.exports = moveList;
