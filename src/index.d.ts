/**
 * dynamodb-toolkit — main entry point.
 *
 * Re-exports the `Adapter` class, the `Raw<T>` bypass marker, bare helpers
 * (`sleep`, `seq`, `random`), and type surfaces. JSDoc lives at each symbol's
 * defining module; IDE hover follows the re-export chain.
 */

export {Raw, RawMarked, raw} from './raw.js';
export {sleep} from './sleep.js';
export {seq} from './seq.js';
export {random} from './random.js';
export {
  Adapter,
  type AdapterOptions,
  type GetOptions,
  type PutOptions,
  type PatchOptions,
  type DeleteOptions,
  type CloneOptions,
  type MoveOptions,
  type MassOptions,
  type ListOptions,
  type BatchDescriptor
} from './adapter/adapter.js';
export {type AdapterHooks, type OpName} from './adapter/hooks.js';
export {TransactionLimitExceededError} from './adapter/transaction-upgrade.js';
export {
  ToolkitError,
  ConsistentReadOnGSIRejected,
  NoIndexForSortField,
  BadFilterField,
  BadFilterOp,
  KeyFieldChanged,
  CreatedAtFieldNotDeclared,
  CascadeNotDeclared
} from './errors.js';

// Type re-exports from SDK peers for convenience.
export type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
export type {NativeAttributeValue} from '@aws-sdk/util-dynamodb';
