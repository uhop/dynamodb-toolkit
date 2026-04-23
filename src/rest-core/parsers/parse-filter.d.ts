/**
 * One parsed `<op>-<field>=<value>` clause. Shape is polymorphic by `op`:
 * no-value ops (`ex`, `nx`) omit `value`; multi-value ops (`in`, `btw`)
 * carry `value` as an array (already split per the first-character-
 * delimiter rule); single-value ops carry `value` as a scalar string.
 */
export type FilterClause =
  | {field: string; op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'beg' | 'ct'; value: string}
  | {field: string; op: 'in' | 'btw'; value: string[]}
  | {field: string; op: 'ex' | 'nx'};

/**
 * Parse all `<op>-<field>=<value>` query parameters into a clause list.
 * Pure shape extraction — no type coercion, no allowlist check, no
 * expression emission. Returns an empty list when no matching keys are
 * present. See `adapter.applyFilter` for the compiler that validates and
 * emits FilterExpression / KeyConditionExpression.
 *
 * @param query String-coerced query map (one level, values string or string[]).
 * @returns Clause list in query-order. Keys whose op prefix doesn't match
 *   a registered op token are silently skipped — they're treated as
 *   ordinary (non-filter) query params.
 */
export function parseFilter(query: Record<string, string | string[]>): FilterClause[];
