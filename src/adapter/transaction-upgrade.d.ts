import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import type {BatchDescriptor} from './adapter.js';

/**
 * Thrown when an auto-upgraded transaction would exceed DynamoDB's
 * per-call ceiling of 100 actions.
 */
export class TransactionLimitExceededError extends Error {
  /** Total action count that triggered the error (main op + checks). */
  readonly actionCount: number;
  /**
   * @param actionCount Total action count that triggered the error.
   */
  constructor(actionCount: number);
}

/**
 * Dispatch a write — either as a single Command or an auto-upgraded
 * `TransactWriteItems`. Used internally by the Adapter.
 *
 * @param client The DynamoDB DocumentClient.
 * @param batch The main write descriptor.
 * @param checks Extra checks from `hooks.checkConsistency`. `null` / `undefined`
 *   dispatches the main op alone; any array triggers a transaction.
 * @returns The raw SDK response — either the single-op Command output (Put/Update/Delete)
 *   or the `TransactWriteItemsCommand` output when upgraded. Callers usually ignore it.
 * @throws {@link TransactionLimitExceededError} when combined actions > 100.
 */
export function dispatchWrite(client: DynamoDBDocumentClient, batch: BatchDescriptor, checks: BatchDescriptor[] | null | undefined): Promise<unknown>;
