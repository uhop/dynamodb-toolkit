// Resolve a `?sort=name` / `?sort=-name` query value to `{index, descending}`.
//
// `sortableIndices` maps field names to GSI/LSI names (e.g.
// `{name: 'by-name-idx', createdAt: 'by-date-idx'}`). Descending prefix `-`
// is extracted by `parseSort`; this helper adds the index lookup + refusal.
//
// Refuses with `NoIndexForSortField` when the caller requested a sort but
// no index is mapped for that field. The toolkit does not in-memory-sort
// (per the no-client-side-list-manipulation principle); if the caller's
// sort field has no matching index, the request fails loud.

import {parseSort} from '../parsers/parse-sort.js';
import {NoIndexForSortField} from '../../errors.js';

export const resolveSort = (query, sortableIndices = {}) => {
  const sort = parseSort(query.sort);
  if (!sort) return {index: undefined, descending: false};
  const index = sortableIndices[sort.field];
  if (!index) throw new NoIndexForSortField(sort.field);
  return {index, descending: sort.direction === 'desc'};
};
