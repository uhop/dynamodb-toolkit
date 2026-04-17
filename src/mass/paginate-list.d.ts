import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/** Pagination window for {@link paginateList}. */
export interface PaginateOptions {
  /** Zero-based starting offset. Default `0`. */
  offset?: number;
  /** Maximum items per page. Default `10`. */
  limit?: number;
}

/** Shape returned by {@link paginateList}. */
export interface PaginatedResult<T = Record<string, unknown>> {
  /** The fetched items for this page. */
  data: T[];
  /** Echoed (and clamped) offset. */
  offset: number;
  /** Echoed (and clamped) limit. */
  limit: number;
  /** Total matches across the whole query. Omitted when `needTotal: false`. */
  total?: number;
}

/**
 * Offset/limit pagination over `Query` or `Scan`. When `params.FilterExpression`
 * is set, accumulates matches across pages — DynamoDB's `Limit` is pre-filter,
 * so a naive read returns short/empty pages. With `needTotal: true` (default),
 * counts the remaining matches via `Select: 'COUNT'` and returns `total`.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @param options Offset and limit window.
 * @param needTotal Whether to include `total` in the result. Default `true`.
 * @param minLimit Minimum request `Limit`. Default `10`.
 * @param maxLimit Clamp on the effective `limit`. Default `100`.
 * @returns The requested page: `data` holds up to `limit` matching items, `offset` and
 *   `limit` echo the effective values after clamping, `total` (when requested) is the
 *   count of all matches available from `offset` onward.
 */
export function paginateList<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  options?: PaginateOptions,
  needTotal?: boolean,
  minLimit?: number,
  maxLimit?: number
): Promise<PaginatedResult<T>>;
