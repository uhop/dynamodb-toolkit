import type {TransactWriteDescriptor, TransactWriteOptionsDescriptor} from './apply-transaction.js';

/** A single failed action extracted from a `TransactionCanceledException`. */
export interface TransactionFailure {
  /** Position of this failure — matches the 0-based index of the descriptor in the flattened input. */
  index: number;
  /** The original descriptor that was sent to DynamoDB, if pairing succeeded. */
  descriptor?: TransactWriteDescriptor;
  /**
   * SDK `Code` — the per-action failure kind. Common values:
   * `'ConditionalCheckFailed'`, `'ItemCollectionSizeLimitExceeded'`,
   * `'TransactionConflict'`, `'ProvisionedThroughputExceeded'`,
   * `'ThrottlingError'`, `'ValidationError'`, `'None'` (filtered out — only failures are reported).
   */
  code: string;
  /** Human-readable SDK message, when provided. */
  message?: string;
  /**
   * The item as it exists in the table at the time of the check. Present only
   * when the matching descriptor set `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'`
   * (via `returnFailedItem: true` on the `make*` builder or the `params`).
   */
  item?: Record<string, unknown>;
}

/** Structured report produced by {@link explainTransactionCancellation}. */
export interface TransactionCancellationExplanation {
  /** One entry per failing action. `'None'` entries in `CancellationReasons` are omitted. */
  failures: TransactionFailure[];
  /** Pre-formatted human-readable summary suitable for logs. */
  message: string;
}

/**
 * Map a `TransactionCanceledException`'s `CancellationReasons` array back to
 * the input descriptors so callers can produce actionable error messages.
 *
 * Pass the **same variadic args** you passed to `applyTransaction` — the helper
 * walks them identically (null skipped, arrays flattened, options sentinels ignored)
 * to reconstruct the 1:1 action-descriptor order that DynamoDB echoed back.
 *
 * @param err The thrown error. Anything other than a `TransactionCanceledException`
 *   returns `null` so callers can early-exit in a `catch` block.
 * @param requests The descriptors that were passed to `applyTransaction`.
 * @returns A `{failures, message}` explanation, or `null` if `err` isn't a cancellation.
 */
export function explainTransactionCancellation(
  err: unknown,
  ...requests: (TransactWriteDescriptor | TransactWriteDescriptor[] | TransactWriteOptionsDescriptor | null)[]
): TransactionCancellationExplanation | null;
