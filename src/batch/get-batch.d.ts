import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

export interface BatchGetDescriptor {
  action: 'get';
  params: Record<string, unknown>;
}

export interface BatchGetResult {
  table: string;
  item: Record<string, unknown>;
}

export function getBatch(client: DynamoDBDocumentClient, ...requests: (BatchGetDescriptor | BatchGetDescriptor[] | null)[]): Promise<BatchGetResult[]>;
