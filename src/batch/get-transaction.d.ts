import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

export interface TransactGetDescriptor {
  action: 'get';
  params: Record<string, unknown>;
  adapter?: unknown;
}

export interface TransactGetResult {
  table: string;
  item: Record<string, unknown> | null;
  adapter?: unknown;
}

export function getTransaction(
  client: DynamoDBDocumentClient,
  ...requests: (TransactGetDescriptor | TransactGetDescriptor[] | null)[]
): Promise<TransactGetResult[]>;
