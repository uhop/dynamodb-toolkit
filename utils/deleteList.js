'use strict';

// iteratively delete a list of items by keys

const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');
const readList = require('./readList');

const deleteListByKeys = require('./deleteListByKeys');

const identity = x => x;

const deleteList = async (client, params, keyFn = identity) => {
  params = cleanParams(cloneParams(params));
  let processed = 0;
  while (params) {
    params = await readList(client, params, async data => {
      if (data.Items.length) {
        processed += await deleteListByKeys(client, params.TableName, data.Items.map(keyFn).filter(identity));
      }
    });
  }
  return processed;
};

deleteList.byKeys = deleteListByKeys;

module.exports = deleteList;
