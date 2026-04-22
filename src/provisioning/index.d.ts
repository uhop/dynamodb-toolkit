/**
 * dynamodb-toolkit/provisioning — table-lifecycle support.
 *
 * `ensureTable` is ADD-only (never drops tables/indices; never emits
 * destructive operations). `verifyTable` returns a structured diff by
 * default, or throws `TableVerificationFailed` on `{throwOnMismatch}`.
 * The optional descriptor record (opt-in via `descriptorKey` on the
 * adapter) lets verify catch drift that `DescribeTable` can't see —
 * marshalling helpers, search mirrors, `filterable` allowlist, etc.
 */

export {
  ensureTable,
  buildCreateTableInput,
  buildAddGsiInput,
  planAddOnly,
  describeTable,
  executePlan,
  type PlanStep,
  type EnsureTablePlan,
  type EnsureTableResult,
  type EnsureTableOptions
} from './ensure-table.js';

export {verifyTable, diffTable, type TableDiff, type VerifyTableResult, type VerifyTableOptions} from './verify-table.js';

export {
  DESCRIPTOR_VERSION,
  buildDescriptorSnapshot,
  compareDescriptor,
  descriptorRecordKey,
  readDescriptor,
  writeDescriptor,
  type DescriptorSnapshot
} from './descriptor.js';

export {extractDeclaration, type ProvisioningDeclaration} from './declaration.js';
