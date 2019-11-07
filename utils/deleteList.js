'use strict';

// iteratively delete a list of items by keys

const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');
const readList = require('./readList');

const deleteListByKeys = require('./deleteListByKeys');

const deleteList = async (client, params) => {
  // prepare parameters
  params = cleanParams(cloneParams(params));

  // iterate over parameters deleting records
  let processed = 0;
  while(params) {
    params = await readList(client, params, async data => {
      if (data.Items.length) {
        processed += await deleteListByKeys(client, params.TableName, data.Items);
      }
    });
  }
  return processed;
};

deleteList.byKeys = deleteListByKeys;

module.exports = deleteList;
