export interface ParsePagingOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export interface ParsedPaging {
  offset: number;
  limit: number;
}

export function parsePaging(input?: {offset?: string | number; limit?: string | number} | null, options?: ParsePagingOptions): ParsedPaging;
