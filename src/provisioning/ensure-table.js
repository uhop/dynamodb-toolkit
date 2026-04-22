// ensureTable: ADD-only table provisioning from an adapter declaration.
//
// Emits a plan by diffing the declaration against DescribeTable output.
// Executes only when `{yes: true}` is passed; default returns the plan
// without writing. Never emits destructive operations — extra GSIs in
// the live table are reported ("skipped") but never dropped. Declaration
// legality (e.g., adding an LSI post-creation) is delegated to DynamoDB
// — the SDK rejects at execution and the error surfaces unchanged.

import {CreateTableCommand, DescribeTableCommand, UpdateTableCommand} from '@aws-sdk/client-dynamodb';

import {attributeDefinitions, baseKeySchema, extractDeclaration, indexKeySchema, splitIndices, toProjection} from './declaration.js';
import {writeDescriptor} from './descriptor.js';

const isNotFound = err => err && err.name === 'ResourceNotFoundException';

// Build the full CreateTableCommand input from the declaration.
export const buildCreateTableInput = decl => {
  const {gsi, lsi} = splitIndices(decl);
  const input = {
    TableName: decl.table,
    AttributeDefinitions: attributeDefinitions(decl),
    KeySchema: baseKeySchema(decl),
    BillingMode: decl.billingMode
  };
  if (decl.billingMode === 'PROVISIONED') {
    if (!decl.provisionedThroughput) {
      throw new Error('ensureTable: billingMode PROVISIONED requires provisionedThroughput');
    }
    input.ProvisionedThroughput = decl.provisionedThroughput;
  }
  if (gsi.length) {
    input.GlobalSecondaryIndexes = gsi.map(({name, idx}) => {
      const entry = {
        IndexName: name,
        KeySchema: indexKeySchema(decl, idx),
        Projection: toProjection(idx.projection)
      };
      if (decl.billingMode === 'PROVISIONED') {
        entry.ProvisionedThroughput = decl.provisionedThroughput;
      }
      return entry;
    });
  }
  if (lsi.length) {
    input.LocalSecondaryIndexes = lsi.map(({name, idx}) => ({
      IndexName: name,
      KeySchema: indexKeySchema(decl, idx),
      Projection: toProjection(idx.projection)
    }));
  }
  if (decl.streamSpecification) {
    input.StreamSpecification = decl.streamSpecification;
  }
  return input;
};

// UpdateTable input adding a single GSI. Caller sends one command per
// missing GSI — DynamoDB rejects multiple index updates per call.
export const buildAddGsiInput = (decl, name, idx) => ({
  TableName: decl.table,
  AttributeDefinitions: attributeDefinitions(decl),
  GlobalSecondaryIndexUpdates: [
    {
      Create: {
        IndexName: name,
        KeySchema: indexKeySchema(decl, idx),
        Projection: toProjection(idx.projection),
        ...(decl.billingMode === 'PROVISIONED' && decl.provisionedThroughput ? {ProvisionedThroughput: decl.provisionedThroughput} : {})
      }
    }
  ]
});

// Diff the declaration against the live table description and produce a
// plan. Each step is one of:
//   {action: 'create', params: <CreateTableInput>}
//   {action: 'add-gsi', name, params: <UpdateTableInput>}
//   {action: 'skip-extra-gsi', name}  (reported only; never executed)
//   {action: 'skip-extra-lsi', name}  (LSIs can't be added post-creation anyway)
//
// `summary` is an array of plain-text lines suitable for --dry-run or
// `console.log(plan.summary.join('\n'))` output.
export const planAddOnly = (decl, describeOutput) => {
  const steps = [];
  const summary = [];

  if (!describeOutput) {
    const params = buildCreateTableInput(decl);
    steps.push({action: 'create', params});
    const indexNote = (params.GlobalSecondaryIndexes || [])
      .map(g => ` + GSI ${g.IndexName} (${g.KeySchema.map(k => `${k.AttributeName}:${k.KeyType}`).join(', ')})`)
      .concat((params.LocalSecondaryIndexes || []).map(l => ` + LSI ${l.IndexName} (${l.KeySchema.map(k => `${k.AttributeName}:${k.KeyType}`).join(', ')})`))
      .join('\n');
    summary.push(`Would CREATE table ${decl.table}` + (indexNote ? '\n' + indexNote : ''));
    return {tableName: decl.table, steps, summary};
  }

  const existingGsi = new Map((describeOutput.GlobalSecondaryIndexes || []).map(g => [g.IndexName, g]));
  const existingLsi = new Map((describeOutput.LocalSecondaryIndexes || []).map(l => [l.IndexName, l]));

  const {gsi: declGsi, lsi: declLsi} = splitIndices(decl);

  for (const {name, idx} of declGsi) {
    if (!existingGsi.has(name)) {
      steps.push({action: 'add-gsi', name, params: buildAddGsiInput(decl, name, idx)});
      summary.push(
        `Would ADD GSI ${name} (${indexKeySchema(decl, idx)
          .map(k => `${k.AttributeName}:${k.KeyType}`)
          .join(', ')})`
      );
    } else {
      existingGsi.delete(name);
    }
  }
  for (const {name} of declLsi) {
    if (!existingLsi.has(name)) {
      // LSIs can only be declared at CreateTable time. Surface as a no-op
      // plan entry; executing a create-LSI against an existing table
      // fails at the SDK level (which is fine — toolkit doesn't
      // pre-check legality).
      steps.push({action: 'skip-missing-lsi', name});
      summary.push(`LSI ${name} missing — can only be added at CreateTable; skipping (DynamoDB rejects add-LSI on existing tables)`);
    } else {
      existingLsi.delete(name);
    }
  }

  for (const name of existingGsi.keys()) {
    steps.push({action: 'skip-extra-gsi', name});
    summary.push(`Extra GSI ${name} present in table, not in declaration (skipped)`);
  }
  for (const name of existingLsi.keys()) {
    steps.push({action: 'skip-extra-lsi', name});
    summary.push(`Extra LSI ${name} present in table, not in declaration (skipped)`);
  }

  if (!steps.length) {
    summary.push(`Table ${decl.table} matches declaration — nothing to do`);
  }

  return {tableName: decl.table, steps, summary};
};

// Fetch the live table description, returning `null` when the table
// doesn't exist. Any other SDK error propagates unchanged.
export const describeTable = async (client, tableName) => {
  try {
    const out = await client.send(new DescribeTableCommand({TableName: tableName}));
    return out.Table || null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

// Execute the steps in a plan. Creates land first, GSI-adds after. Skip
// steps are no-ops. Returns `{executed: string[]}` with human-readable
// step IDs for logging.
export const executePlan = async (client, plan) => {
  const executed = [];
  for (const step of plan.steps) {
    if (step.action === 'create') {
      await client.send(new CreateTableCommand(step.params));
      executed.push(`create:${plan.tableName}`);
    } else if (step.action === 'add-gsi') {
      await client.send(new UpdateTableCommand(step.params));
      executed.push(`add-gsi:${step.name}`);
    }
    // skip-* steps: no-op by design.
  }
  return {executed};
};

/**
 * ensureTable(adapterOrDeclaration, options?)
 *
 * Default (no `{yes: true}`): computes and returns the plan. No writes.
 * `{yes: true}`: executes the plan. Returns `{plan, executed}`.
 * `{dryRun: true}`: explicit plan-only (default behaviour, documented).
 *
 * When `descriptorKey` is set on the declaration AND the plan executes
 * (either a fresh create or add-GSI), the descriptor record is written
 * after the table is ACTIVE. On a no-op plan with `yes: true`, the
 * descriptor is still written if missing so existing IaC-managed tables
 * can opt into toolkit management without a fresh create.
 */
export const ensureTable = async (adapterOrDeclaration, options = {}) => {
  const decl = extractDeclaration(adapterOrDeclaration);
  const live = await describeTable(decl.client, decl.table);
  const plan = planAddOnly(decl, live);

  if (!options.yes || options.dryRun) {
    return plan;
  }

  const result = await executePlan(decl.client, plan);

  if (decl.descriptorKey) {
    await writeDescriptor(decl);
    result.descriptorWritten = true;
  }

  return {plan, ...result};
};
