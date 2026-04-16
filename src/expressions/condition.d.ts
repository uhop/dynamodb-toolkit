export type ConditionClause =
  | {path: string; op: '=' | '<>' | '<' | '<=' | '>' | '>='; value: unknown}
  | {path: string; op: 'exists' | 'notExists'}
  | {path: string; op: 'beginsWith' | 'contains'; value: unknown}
  | {path: string; op: 'in'; values: unknown[]}
  | {op: 'and' | 'or'; clauses: ConditionClause[]}
  | {op: 'not'; clause: ConditionClause};

export function buildCondition<T extends Record<string, unknown>>(clauses: ConditionClause[] | null | undefined, params?: T): T;
