import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

export function iterateList(client: DynamoDBDocumentClient, params: Record<string, unknown>): AsyncGenerator<Record<string, unknown>>;

export function iterateItems<T = Record<string, unknown>>(client: DynamoDBDocumentClient, params: Record<string, unknown>): AsyncGenerator<T>;
