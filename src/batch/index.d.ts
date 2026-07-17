/**
 * Batch + transaction chunkers with `UnprocessedItems` / `UnprocessedKeys`
 * retry and exponential backoff. JSDoc lives on each re-exported symbol.
 */

export {applyBatch, type BatchWriteDescriptor, type BatchWriteOptionsDescriptor} from './apply-batch.js';
export {
  applyTransaction,
  TRANSACTION_LIMIT,
  type TransactWriteDescriptor,
  type TransactWriteOptions,
  type TransactWriteOptionsDescriptor
} from './apply-transaction.js';
export {explainTransactionCancellation, type TransactionFailure, type TransactionCancellationExplanation} from './explain-transaction.js';
export {getBatch, type BatchGetDescriptor, type BatchGetResult, type BatchGetOptionsDescriptor} from './get-batch.js';
export {getTransaction, type TransactGetDescriptor, type TransactGetResult} from './get-transaction.js';
export {backoff, type RetryOptions} from './backoff.js';
