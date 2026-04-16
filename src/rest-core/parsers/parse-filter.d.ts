export interface ParseFilterOptions {
  mode?: 'substring' | 'prefix' | 'exact' | 'tokenized';
  caseSensitive?: boolean;
}

export interface ParsedFilter {
  query: string;
  mode?: 'substring' | 'prefix' | 'exact' | 'tokenized';
  caseSensitive?: boolean;
}

export function parseFilter(input: string | string[] | null | undefined, options?: ParseFilterOptions): ParsedFilter | null;
