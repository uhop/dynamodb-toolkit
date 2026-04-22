export {paginateList} from './paginate-list.js';
export {iterateList, iterateItems} from './iterate-list.js';
export {readList, readListGetItems} from './read-list.js';
export {readByKeys} from './read-by-keys.js';
export {mergeMapFn} from './map-fns.js';
export {writeItems} from './write-items.js';
export {deleteList, deleteByKeys} from './delete-list.js';
export {copyList} from './copy-list.js';
export {moveList} from './move-list.js';
export {getTotal} from './get-total.js';
export {encodeCursor, decodeCursor} from './cursor.js';

// Deprecated aliases — removed in a future minor (3.3.0 or 4.0.0).
// Prior names conflated "List" (DB-produced) with "ByKeys" (caller-supplied);
// the rename aligns with the bulk-individual vs list-operation classification.
// See dev-docs/hierarchical-implementation-plan.md §Phase 3.2.0.

import {readByKeys} from './read-by-keys.js';
import {deleteByKeys} from './delete-list.js';
import {writeItems} from './write-items.js';

let _warnedReadList = false;
let _warnedReadOrderedList = false;
let _warnedDeleteList = false;
let _warnedWriteList = false;

export const readListByKeys = (client, tableName, keys, params) => {
  if (!_warnedReadList) {
    _warnedReadList = true;
    console.warn('dynamodb-toolkit: readListByKeys is deprecated, use readByKeys (length-preserving, caller-order).');
  }
  return readByKeys(client, tableName, keys, params);
};

export const readOrderedListByKeys = (client, tableName, keys, params) => {
  if (!_warnedReadOrderedList) {
    _warnedReadOrderedList = true;
    console.warn('dynamodb-toolkit: readOrderedListByKeys is deprecated, use readByKeys (same behaviour, new name).');
  }
  return readByKeys(client, tableName, keys, params);
};

export const deleteListByKeys = (client, tableName, keys) => {
  if (!_warnedDeleteList) {
    _warnedDeleteList = true;
    console.warn('dynamodb-toolkit: deleteListByKeys is deprecated, use deleteByKeys.');
  }
  return deleteByKeys(client, tableName, keys);
};

export const writeList = (client, tableName, items, mapFn) => {
  if (!_warnedWriteList) {
    _warnedWriteList = true;
    console.warn('dynamodb-toolkit: writeList is deprecated, use writeItems (same behaviour, new name — bulk-individual write, not a list op).');
  }
  return writeItems(client, tableName, items, mapFn);
};
