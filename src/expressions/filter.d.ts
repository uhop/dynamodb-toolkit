export interface FilterOptions {
  fields?: string | string[] | null;
  prefix?: string;
  caseSensitive?: boolean;
}

export function buildFilter<T extends Record<string, unknown>>(
  searchable: Record<string, 1 | true>,
  query: string | null | undefined,
  options?: FilterOptions,
  params?: T
): T;

export function buildFilterByExample<T extends Record<string, unknown>>(example: Record<string, unknown>, params?: T): T;
