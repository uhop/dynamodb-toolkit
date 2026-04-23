// Build `ListOptions` for `adapter.getList` / `adapter._buildListParams` from a
// parsed query map. Composes the REST-core parsers with policy-driven caps so
// every adapter gets the same pagination / filter / fields plumbing.
//
// Returns a `ListOptions`-shaped object; caller merges it with sort (resolved
// separately via `resolveSort`) and `descending`.

import {parseFields} from '../parsers/parse-fields.js';
import {parseFilter} from '../parsers/parse-filter.js';
import {parseSearch} from '../parsers/parse-search.js';
import {parsePaging} from '../parsers/parse-paging.js';
import {parseFlag} from '../parsers/parse-flag.js';

export const buildListOptions = (query, policy) => {
  const fields = parseFields(query.fields);
  const search = parseSearch(query.search);
  const filter = parseFilter(query);
  const paging = parsePaging(query, {
    defaultLimit: policy.defaultLimit,
    maxLimit: policy.maxLimit,
    maxOffset: policy.maxOffset
  });
  const consistent = parseFlag(query.consistent);
  /** @type {import('./build-list-options.js').ListOptionsBase} */
  const out = {
    ...paging,
    consistent,
    needTotal: policy.needTotal
  };
  if (fields) out.fields = fields;
  if (search) out.search = search.query;
  if (filter.length) out.filter = filter;
  return out;
};
