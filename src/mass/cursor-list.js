// @ts-self-types="./cursor-list.d.ts"
// Cursor (LastEvaluatedKey) pagination — DynamoDB's native paging model.
// Constant cost per page regardless of depth, unlike offset paging which
// walks COUNT pages toward the offset. No total — counting would re-scan.
//
// The per-request `Limit` is always the remaining capacity, so a filtered
// page can never overshoot `limit`: whole DynamoDB pages are consumed and
// the emitted cursor always sits on a page boundary — resume neither skips
// nor duplicates items. Filtered pages may come back short (DynamoDB's
// `Limit` is pre-filter); callers keep paging while `cursor` is present.

import {cleanParams} from '../expressions/clean-params.js';
import {cloneParams} from '../expressions/clone-params.js';
import {sendQueryOrScan} from './send-query-or-scan.js';
import {encodeCursor, decodeCursor} from './cursor.js';

export const cursorList = async (client, params, options, maxLimit = 100) => {
  options = options || {};
  let limit = 10;
  if ('limit' in options && !isNaN(options.limit)) limit = Math.min(maxLimit, Math.floor(+options.limit));
  if (limit <= 0) return {data: [], limit};

  const p = cleanParams(cloneParams(params));
  if (options.cursor) {
    const startKey = decodeCursor(options.cursor).LastEvaluatedKey;
    if (startKey) p.ExclusiveStartKey = startKey;
  }

  let result = [];
  let lastKey;
  for (;;) {
    p.Limit = limit - result.length;
    const data = await sendQueryOrScan(client, p);
    if (data.Items?.length) result = result.concat(data.Items);
    lastKey = data.LastEvaluatedKey;
    if (!lastKey || result.length >= limit) break;
    p.ExclusiveStartKey = lastKey;
  }

  const out = {data: result, limit};
  if (lastKey) out.cursor = encodeCursor({LastEvaluatedKey: lastKey});
  return out;
};
