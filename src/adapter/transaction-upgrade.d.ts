import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import type {BatchDescriptor} from './adapter.js';

export class TransactionLimitExceededError extends Error {
  readonly actionCount: number;
  constructor(actionCount: number);
}

export function dispatchWrite(client: DynamoDBDocumentClient, batch: BatchDescriptor, checks: BatchDescriptor[] | null | undefined): Promise<unknown>;
