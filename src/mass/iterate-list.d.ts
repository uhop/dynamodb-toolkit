import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/**
 * Async generator yielding raw `Query` / `Scan` response pages.
 * Loops until `LastEvaluatedKey` is absent.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 */
export function iterateList(client: DynamoDBDocumentClient, params: Record<string, unknown>): AsyncGenerator<Record<string, unknown>>;

/**
 * Async generator yielding individual items from successive `Query` / `Scan`
 * pages. Convenience wrapper over {@link iterateList}.
 *
 * @param client The DynamoDB DocumentClient.
 * @param params DynamoDB `Query` / `Scan` input.
 */
export function iterateItems<T = Record<string, unknown>>(client: DynamoDBDocumentClient, params: Record<string, unknown>): AsyncGenerator<T>;
