export interface SortClause {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ParsedSort extends SortClause {
  chain: SortClause[];
}

export function parseSort(input: string | string[] | null | undefined): ParsedSort | null;
