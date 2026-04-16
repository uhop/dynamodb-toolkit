import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

export function readOrderedListByKeys<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
  params?: Record<string, unknown>
): Promise<(T | undefined)[]>;
