import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/**
 * Bulk-write items via chunked `BatchWriteItem`. Bulk-individual operation
 * — the caller supplies the set; the toolkit batches per the SDK's 25-item
 * limit. Plural form of `put` / `post`.
 *
 * @param client The DynamoDB DocumentClient.
 * @param tableName Target table.
 * @param items Items to write.
 * @param mapFn Optional transform applied to each item before writing.
 *   Returning a falsy value skips that item.
 * @returns Count of items DynamoDB accepted (excludes entries `mapFn`
 *   dropped with a falsy return).
 */
export function writeItems(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
  mapFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;
