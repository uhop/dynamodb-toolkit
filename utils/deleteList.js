'use strict';

// iteratively delete a list of items by keys

const batchWrite = require('./batchWrite');
const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');
const readList = require('./readList');

const deleteKeyList = async (client, tableName, keyList) => {
  if (!keyList.length) return;
  const params = {
    RequestItems: {
      [tableName]: keyList.map(key => ({DeleteRequest: {Key: key}}))
    }
  };
  return batchWrite(client, params);
};

const deleteList = async (client, params) => {
  // prepare parameters
  params = cleanParams(cloneParams(params));
  params.Limit = 25;

  // iterate over parameters deleting records
  let processed = 0;
  while(params) {
    params = await readList(client, params, async data => {
      if (data.Items.length) {
        processed += data.Items.length;
        await deleteKeyList(client, params.TableName, data.Items);
      }
    });
  }
  return processed;
};

deleteList.byKeys = async (client, tableName, keys) => {
  if (keys.length > 25) {
    for (let offset = 0; offset < keys.length; offset += 25) {
      await deleteKeyList(client, tableName, keys.slice(offset, offset + 25));
    }
  } else {
    await deleteKeyList(client, tableName, keys);
  }
  return keys.length;
};

module.exports = deleteList;
