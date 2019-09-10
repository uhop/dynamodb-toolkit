'use strict';

// iteratively copy a list of items by keys

const batchWrite = require('./batchWrite');
const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');
const readList = require('./readList');

const writeKeyList = async (client, tableName, items) => {
  items = items.filter(item => item);
  if (!items.length) return;
  const params = {
    RequestItems: {
      [tableName]: items.map(item => ({PutRequest: {Item: item}}))
    }
  };
  return batchWrite(client, params);
};

const copyList = async (client, params, mapFn) => {
  // prepare parameters
  params = cleanParams(cloneParams(params));
  params.Limit = 25;

  // iterate over parameters copying records
  let processed = 0;
  for(;;) {
    params = await readList(client, params, async data => {
      if (data.Items.length) {
        processed += data.Items.length;
        await writeKeyList(client, params.TableName, data.Items.map(mapFn));
      }
    });
    if (!params) break;
  }
  return processed;
};

copyList.byKeys = async (client, tableName, keys, mapFn) => {
  let processed = 0;
  if (keys.length > 25) {
    for (let offset = 0; offset < keys.length; offset += 25) {
      const items = await readList.byKeys(client, tableName, keys.slice(offset, offset + 25));
      processed += items.length;
      await writeKeyList(client, tableName, items.map(mapFn));
    }
  } else {
    const items = await readList.byKeys(client, tableName, keys);
    processed += items.length;
    await writeKeyList(client, tableName, items.map(mapFn));
  }
  return processed;
};

module.exports = copyList;
