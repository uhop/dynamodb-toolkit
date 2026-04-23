// dynamodb-toolkit/provisioning — module entry.
//
// Table-lifecycle support driven by the adapter declaration. Keeps
// provisioning out of the adapter runtime so IaC-managed tables
// (Terraform / CDK / CloudFormation) never carry the cost; these
// helpers are opt-in via `import` from this submodule path.

export {planTable, ensureTable, buildCreateTableInput, buildAddGsiInput, planAddOnly, describeTable, executePlan} from './ensure-table.js';
export {verifyTable, diffTable} from './verify-table.js';
export {
  DESCRIPTOR_VERSION,
  buildDescriptorSnapshot,
  compareDescriptor,
  descriptorRecordKey,
  readDescriptor,
  writeDescriptor
} from './descriptor.js';
export {extractDeclaration} from './declaration.js';
