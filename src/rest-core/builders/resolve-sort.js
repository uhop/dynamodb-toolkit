// Resolve a `?sort=name` / `?sort=-name` query value to `{index, descending}`.
//
// `sortableIndices` maps field names to GSI names (e.g. `{name: '-t-name-index'}`);
// an unmapped sort field resolves to `index: undefined` which the Adapter
// interprets as "ignore sort." Descending prefix `-` is extracted by
// `parseSort`; this helper only adds the index lookup.

import {parseSort} from '../parsers/parse-sort.js';

export const resolveSort = (query, sortableIndices = {}) => {
  const sort = parseSort(query.sort);
  if (!sort) return {index: undefined, descending: false};
  return {index: sortableIndices[sort.field], descending: sort.direction === 'desc'};
};
