import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

/** DynamoDB's per-call ceiling on `TransactWriteItems` actions — `100`. */
export const TRANSACTION_LIMIT: number;

/** A descriptor consumed by {@link applyTransaction}. */
export interface TransactWriteDescriptor {
  /**
   * Action kind:
   * - `check` — `ConditionCheck` only, no write
   * - `put` — insert / replace
   * - `patch` — `Update`
   * - `delete` — remove by key
   */
  action: 'check' | 'delete' | 'put' | 'patch';
  /**
   * DynamoDB command input. Must include `TableName`, a `Key` (for
   * `check` / `patch` / `delete`) or `Item` (for `put`), and any
   * `ConditionExpression` / `UpdateExpression` / attribute maps.
   */
  params: Record<string, unknown>;
}

/**
 * Execute a single `TransactWriteItems` call covering all supplied
 * descriptors. Transactions are atomic — no chunking. Accepts descriptors
 * as positional args, arrays of descriptors, or `null` (skipped).
 *
 * @param client The DynamoDB DocumentClient.
 * @param requests Descriptors, arrays of descriptors, and/or `null` holes.
 * @returns Number of actions executed. `0` when the input resolves to nothing.
 * @throws When the combined action count exceeds {@link TRANSACTION_LIMIT}.
 */
export function applyTransaction(client: DynamoDBDocumentClient, ...requests: (TransactWriteDescriptor | TransactWriteDescriptor[] | null)[]): Promise<number>;
