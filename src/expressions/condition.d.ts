/**
 * Declarative `ConditionExpression` clause. Compose trees via the `and` / `or`
 * / `not` variants. Paths follow the same dotted-segment convention as the
 * rest of the toolkit — pure-digit segments become array indices.
 */
export type ConditionClause =
  /** Comparison: `path op value`. */
  | {path: string; op: '=' | '<>' | '<' | '<=' | '>' | '>='; value: unknown}
  /** Presence check: `attribute_exists(path)` / `attribute_not_exists(path)`. */
  | {path: string; op: 'exists' | 'notExists'}
  /** DynamoDB function: `begins_with(path, value)` / `contains(path, value)`. */
  | {path: string; op: 'beginsWith' | 'contains'; value: unknown}
  /** Inclusion: `path IN (values...)`. */
  | {path: string; op: 'in'; values: unknown[]}
  /** Boolean combinator — children joined with `AND` / `OR`. */
  | {op: 'and' | 'or'; clauses: ConditionClause[]}
  /** Negation of a single sub-clause. */
  | {op: 'not'; clause: ConditionClause};

/**
 * Build a `ConditionExpression` from a clause tree. The top-level array is
 * AND-joined — wrap in `{op: 'or', clauses: [...]}` for OR at the top level.
 * Mutates and returns `params`.
 *
 * @param clauses Clause tree. When empty / null, `params` is returned unchanged.
 * @param params Existing DynamoDB params to extend. A fresh object is used when omitted.
 * @returns The same `params` (fresh when omitted), now carrying a `ConditionExpression`
 *   and placeholders — unchanged when `clauses` was empty.
 */
export function buildCondition<T extends Record<string, unknown>>(clauses: ConditionClause[] | null | undefined, params?: T): T;
