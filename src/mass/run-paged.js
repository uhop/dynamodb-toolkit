// Resumable paging primitive for mass ops.
//
// Walks Query/Scan pages, invokes a per-page handler, accumulates a
// MassOpResult envelope, and emits a cursor on a page-boundary stop
// when `maxItems` is exhausted. The `maxItems` cap is soft — pages are
// not split mid-way because the idempotent-phases model makes
// re-processing items on resume a non-issue (put is idempotent;
// delete is idempotent; condition checks on `ifNotExists` re-reject
// already-written items, which the handler buckets as `skipped`).

import {cleanParams} from '../expressions/clean-params.js';
import {cloneParams} from '../expressions/clone-params.js';
import {readListGetItems} from './read-list.js';
import {encodeCursor, decodeCursor} from './cursor.js';

const addCounts = (into, from) => {
  into.processed += from.processed || 0;
  into.skipped += from.skipped || 0;
  if (from.failed?.length) into.failed.push(...from.failed);
  if (from.conflicts?.length) into.conflicts.push(...from.conflicts);
};

// `onPage(items)` is called with each full page of revived items.
// It must return a `{processed, skipped?, failed?, conflicts?}` partial
// envelope describing what happened on that page. Throwing from
// `onPage` aborts the entire walk — callers bucket per-item failures
// into `failed` / `conflicts` rather than throwing.
export const runPaged = async (client, params, options, onPage) => {
  const opts = options || {};

  let startKey = null;
  let meta;
  if (opts.resumeToken) {
    const payload = decodeCursor(opts.resumeToken);
    startKey = payload.LastEvaluatedKey || null;
    if (payload.meta) meta = payload.meta;
  }

  let p = cleanParams(cloneParams(params));
  if (startKey) p.ExclusiveStartKey = startKey;

  const budget = Number.isFinite(opts.maxItems) && opts.maxItems > 0 ? opts.maxItems : Infinity;
  const result = {processed: 0, skipped: 0, failed: [], conflicts: []};

  for (;;) {
    const {nextParams, items} = await readListGetItems(client, p);
    if (items.length) {
      const pageResult = await onPage(items, meta);
      if (pageResult) addCounts(result, pageResult);
    }

    if (!nextParams) return result; // exhausted — no cursor

    const total = result.processed + result.skipped + result.failed.length + result.conflicts.length;
    if (total >= budget) {
      result.cursor = encodeCursor({LastEvaluatedKey: nextParams.ExclusiveStartKey});
      return result;
    }
    p = nextParams;
  }
};
