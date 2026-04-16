export interface ArrayOp {
  op: 'append' | 'prepend' | 'setAtIndex' | 'removeAtIndex' | 'add';
  path: string;
  values?: unknown[];
  value?: unknown;
  index?: number;
}

export interface UpdateOptions {
  delete?: string[];
  separator?: string;
  arrayOps?: ArrayOp[];
}

export function buildUpdate<T extends Record<string, unknown>>(
  patch: Record<string, unknown>,
  options?: UpdateOptions,
  params?: T
): T & {UpdateExpression: string};
