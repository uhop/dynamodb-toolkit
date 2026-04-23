/**
 * dynamodb-toolkit/provisioning — table-lifecycle support.
 *
 * Two entry points for the ADD-only provisioning flow: `planTable`
 * (read-only; returns the plan) and `ensureTable` (computes the plan and
 * applies it). Neither drops tables/indices; neither emits destructive
 * operations. `verifyTable` returns a structured diff by default, or
 * throws `TableVerificationFailed` on `{throwOnMismatch}`. The optional
 * descriptor record (opt-in via `descriptorKey` on the adapter) lets
 * verify catch drift that `DescribeTable` can't see — marshalling
 * helpers, search mirrors, `filterable` allowlist, etc.
 */

export {
  planTable,
  ensureTable,
  buildCreateTableInput,
  buildAddGsiInput,
  planAddOnly,
  describeTable,
  executePlan,
  type PlanStep,
  type EnsureTablePlan,
  type EnsureTableResult
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
