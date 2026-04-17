import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/**
 * Async generator yielding raw `Query` / `Scan` response pages.
 * Loops until `LastEvaluatedKey` is absent.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @returns Async generator yielding each raw SDK response page (including `Items`,
 *   `Count`, `LastEvaluatedKey`, etc.) until the scan is exhausted.
 */
export function iterateList(client: DynamoDBDocumentClient, params: Record<string, unknown>): AsyncGenerator<Record<string, unknown>>;

/**
 * Async generator yielding individual items from successive `Query` / `Scan`
 * pages. Convenience wrapper over {@link iterateList}.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 * @returns Async generator yielding every matching item, one at a time, across all pages.
 */
export function iterateItems<T = Record<string, unknown>>(client: DynamoDBDocumentClient, params: Record<string, unknown>): AsyncGenerator<T>;
