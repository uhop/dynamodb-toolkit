import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

export interface PaginateOptions {
  offset?: number;
  limit?: number;
}

export interface PaginatedResult<T = Record<string, unknown>> {
  data: T[];
  offset: number;
  limit: number;
  total?: number;
}

export function paginateList<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  options?: PaginateOptions,
  needTotal?: boolean,
  minLimit?: number,
  maxLimit?: number
): Promise<PaginatedResult<T>>;
