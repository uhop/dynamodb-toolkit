import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

export const TRANSACTION_LIMIT: number;

export interface TransactWriteDescriptor {
  action: 'check' | 'delete' | 'put' | 'patch';
  params: Record<string, unknown>;
}

export function applyTransaction(client: DynamoDBDocumentClient, ...requests: (TransactWriteDescriptor | TransactWriteDescriptor[] | null)[]): Promise<number>;
