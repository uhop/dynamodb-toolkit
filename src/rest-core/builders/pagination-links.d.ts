export interface PaginationLinks {
  prev: string | null;
  next: string | null;
}

export type UrlBuilder = (input: {offset: number; limit: number}) => string;

export function paginationLinks(offset: number, limit: number, total: number | undefined, urlBuilder?: UrlBuilder): PaginationLinks;
