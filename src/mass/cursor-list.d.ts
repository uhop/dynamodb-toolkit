import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/** Paging window for {@link cursorList}. */
export interface CursorListOptions {
  /** Opaque cursor from a prior page's `cursor`. Omit for the first page. */
  cursor?: string;
  /** Maximum items for this page. Default `10`. */
  limit?: number;
}

/** Shape returned by {@link cursorList}. */
export interface CursorPage<T = Record<string, unknown>> {
  /** The fetched items for this page. */
  data: T[];
  /** Echoed (and clamped) limit. */
  limit: number;
  /**
   * Opaque cursor for the next page — present when more data may exist.
   * Absent means the listing is exhausted. Note: a page can be shorter than
   * `limit` (or even empty) and still carry a cursor when a
   * `FilterExpression` is in play — keep paging while `cursor` is present.
   */
  cursor?: string;
}

/**
 * Cursor (`LastEvaluatedKey`) pagination over `Query` / `Scan` — DynamoDB's
 * native paging model. Constant cost per page regardless of depth, unlike
 * offset paging which walks COUNT pages toward the offset. Never computes a
 * total. The per-request `Limit` is the remaining page capacity, so whole
 * DynamoDB pages are consumed and the emitted cursor sits on a page
 * boundary — resume neither skips nor duplicates items.
 *
 * Throws `TypeError` when `options.cursor` is malformed or carries an
 * unsupported version — validate wire input with `parseCursor` first.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @param options Cursor and limit window.
 * @param maxLimit Clamp on the effective `limit`. Default `100`.
 * @returns The requested page: up to `limit` items plus a `cursor` when more may exist.
 */
export function cursorList<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  options?: CursorListOptions,
  maxLimit?: number
): Promise<CursorPage<T>>;
