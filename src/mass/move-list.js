// Move items: copy with mapFn then delete originals. Uses BatchWriteItem for both put + delete.

import {applyBatch} from '../batch/apply-batch.js';
import {readList} from './read-list.js';

const identity = x => x;

// Max items per move chunk: 12 puts + 12 deletes = 24 ≤ 25 (BatchWriteItem limit).
// With v3 transaction limit at 100, the batch write limit is still 25.
const MOVE_CHUNK = 12;

export const moveList = async (client, params, mapFn = identity, keyFn = identity) => {
  const tableName = params.TableName;
  let p = params,
    processed = 0;
  while (p) {
    p = await readList(client, p, async data => {
      const items = data.Items || [];
      for (let offset = 0; offset < items.length; offset += MOVE_CHUNK) {
        const slice = items.slice(offset, offset + MOVE_CHUNK);
        // Pair put + delete per item so a falsy mapFn or keyFn drops BOTH legs —
        // otherwise the source gets deleted without its transformed copy being written.
        const pairs = [];
        for (const item of slice) {
          const put = mapFn(item);
          if (!put) continue;
          const key = keyFn(item);
          if (!key) continue;
          pairs.push({put, key});
        }
        if (!pairs.length) continue;
        /** @type {{action: 'put', params: any}[]} */
        const puts = pairs.map(({put}) => ({action: 'put', params: {TableName: tableName, Item: put}}));
        /** @type {{action: 'delete', params: any}[]} */
        const deletes = pairs.map(({key}) => ({action: 'delete', params: {TableName: tableName, Key: key}}));
        processed += await applyBatch(client, [...puts, ...deletes]);
      }
    });
  }
  return processed;
};
