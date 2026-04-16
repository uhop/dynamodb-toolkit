import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

export interface BatchWriteDescriptor {
  action: 'put' | 'delete';
  params: Record<string, unknown>;
}

export function applyBatch(client: DynamoDBDocumentClient, ...requests: (BatchWriteDescriptor | BatchWriteDescriptor[] | null)[]): Promise<number>;
