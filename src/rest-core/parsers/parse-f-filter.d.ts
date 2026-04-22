/**
 * One parsed `f-<field>-<op>=<value>` clause. `values` is always an array:
 * empty for no-value ops (`ex`, `nx`); length-1 for single-value ops;
 * length-N for multi-value ops (`in`, `btw`) already split per the
 * first-character-delimiter rule.
 */
export interface FFilterClause {
  field: string;
  op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in' | 'btw' | 'beg' | 'ct' | 'ex' | 'nx';
  values: string[];
}

/**
 * Parse all `f-<field>-<op>=<value>` query parameters into a clause list.
 * Pure shape extraction — no type coercion, no allowlist check, no
 * expression emission. Returns an empty list when no `f-*` keys are
 * present. See `adapter.applyFFilter` for the compiler that validates and
 * emits FilterExpression / KeyConditionExpression.
 *
 * @param query String-coerced query map (one level, values string or string[]).
 * @returns Clause list in query-order. Clauses with unknown ops are
 *   silently skipped — the `f-` prefix is a coarse routing key, not a
 *   grammar assertion; typos there look like ordinary query params.
 */
export function parseFFilter(query: Record<string, string | string[]>): FFilterClause[];
