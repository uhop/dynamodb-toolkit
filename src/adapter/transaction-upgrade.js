// Auto-upgrade single ops to TransactWriteItems when checkConsistency returns extra actions.
// If checks is null, executes the single op via the appropriate Command and returns its result.
// If checks is an array (possibly empty), executes everything as one TransactWriteItems call.

import {PutCommand, UpdateCommand, DeleteCommand} from '@aws-sdk/lib-dynamodb';
import {applyTransaction, TRANSACTION_LIMIT} from '../batch/apply-transaction.js';

export class TransactionLimitExceededError extends Error {
  constructor(actionCount) {
    super(`Auto-upgraded transaction exceeds the ${TRANSACTION_LIMIT}-action limit: ${actionCount} actions`);
    this.name = 'TransactionLimitExceededError';
    this.actionCount = actionCount;
  }
}

const singleCommand = batch => {
  switch (batch.action) {
    case 'put':
      return new PutCommand(batch.params);
    case 'patch':
      return new UpdateCommand(batch.params);
    case 'delete':
      return new DeleteCommand(batch.params);
    default:
      throw new Error(`Unsupported single-op action: ${batch.action}`);
  }
};

export const dispatchWrite = async (client, batch, checks) => {
  if (!checks) {
    return client.send(singleCommand(batch));
  }
  const total = checks.length + 1;
  if (total > TRANSACTION_LIMIT) throw new TransactionLimitExceededError(total);
  return applyTransaction(client, checks, batch);
};
