// Copy items matching a query/scan, applying mapFn to each.

import {readList} from './read-list.js';
import {writeList} from './write-list.js';

const identity = x => x;

export const copyList = async (client, params, mapFn = identity) => {
  const tableName = params.TableName;
  let p = params,
    processed = 0;
  while (p) {
    p = await readList(client, p, async data => {
      if (data.Items?.length) {
        processed += await writeList(client, tableName, data.Items, mapFn);
      }
    });
  }
  return processed;
};
