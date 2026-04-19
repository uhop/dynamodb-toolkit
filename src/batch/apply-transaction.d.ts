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

/** Transaction-level knobs accepted by {@link applyTransaction}. */
export interface TransactWriteOptions {
  /**
   * Idempotency token. DynamoDB de-duplicates retries carrying the same
   * token for up to 10 minutes — pair with the caller's own retry loop to
   * make transactional writes safe against in-flight failures. 1–36 chars,
   * commonly a `crypto.randomUUID()`.
   */
  clientRequestToken?: string;
  /** `INDEXES` / `TOTAL` / `NONE` — see the SDK `TransactWriteItems` reference. */
  returnConsumedCapacity?: 'INDEXES' | 'TOTAL' | 'NONE';
  /** `SIZE` / `NONE` — controls whether collection-metrics are returned. */
  returnItemCollectionMetrics?: 'SIZE' | 'NONE';
}

/**
 * Sentinel descriptor that carries transaction-level options. Mix with
 * action descriptors in the variadic arg list — order is irrelevant.
 * When multiple options descriptors are passed, later fields override earlier.
 */
export interface TransactWriteOptionsDescriptor {
  options: TransactWriteOptions;
}

/**
 * Execute a single `TransactWriteItems` call covering all supplied
 * descriptors. Transactions are atomic — no chunking. Accepts descriptors
 * as positional args, arrays of descriptors, `{options: ...}` sentinels,
 * or `null` (skipped).
 *
 * @param client The DynamoDB DocumentClient.
 * @param requests Descriptors, arrays of descriptors, `{options}` sentinels, and/or `null` holes.
 * @returns Total number of actions (checks + writes) included in the transaction.
 *   `0` when the input resolves to nothing — in that case no SDK call is made.
 * @throws When the combined action count exceeds {@link TRANSACTION_LIMIT}.
 */
export function applyTransaction(
  client: DynamoDBDocumentClient,
  ...requests: (TransactWriteDescriptor | TransactWriteDescriptor[] | TransactWriteOptionsDescriptor | null)[]
): Promise<number>;
