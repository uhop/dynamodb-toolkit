// verifyTable: compare the declared schema against the live table.
//
// Returns `{ok, diffs}` by default — callers log + continue. Pass
// `{throwOnMismatch: true}` to throw `TableVerificationFailed` instead
// (for CI use). Absent descriptor record is neutral; pass
// `{requireDescriptor: true}` for strict "toolkit-managed" assertion.

import {TableVerificationFailed} from '../errors.js';

import {attributeType, baseKeySchema, extractDeclaration, fromAttributeType, fromProjection, indexKeySchema, splitIndices} from './declaration.js';
import {describeTable} from './ensure-table.js';
import {compareDescriptor, readDescriptor} from './descriptor.js';

const addDiff = (diffs, path, severity, expected, actual) => {
  diffs.push({path, severity, expected, actual});
};

// Compare one index (GSI or LSI) between declaration and live table.
const compareIndex = (decl, declared, live, kind, diffs) => {
  const expectedKeys = indexKeySchema(decl, declared)
    .map(k => `${k.AttributeName}:${k.KeyType}`)
    .join(',');
  const actualKeys = (live.KeySchema || []).map(k => `${k.AttributeName}:${k.KeyType}`).join(',');
  if (expectedKeys !== actualKeys) {
    addDiff(diffs, `${kind}.${live.IndexName}.KeySchema`, 'error', expectedKeys, actualKeys);
  }
  const expectedProjection = Array.isArray(declared.projection) ? declared.projection.slice().sort() : declared.projection;
  const actualRaw = fromProjection(live.Projection);
  const actualProjection = Array.isArray(actualRaw) ? actualRaw.slice().sort() : actualRaw;
  const projEqual = Array.isArray(expectedProjection)
    ? Array.isArray(actualProjection) && expectedProjection.length === actualProjection.length && expectedProjection.every((v, i) => v === actualProjection[i])
    : expectedProjection === actualProjection;
  if (!projEqual) {
    addDiff(diffs, `${kind}.${live.IndexName}.Projection`, 'error', expectedProjection, actualProjection);
  }
};

// Compute the diff array for declaration-vs-live. Order: table
// existence → base key schema → attribute types for declared keys →
// per-GSI checks → per-LSI checks → extras in live table (warn).
export const diffTable = (decl, live) => {
  const diffs = [];
  if (!live) {
    addDiff(diffs, 'table', 'error', 'exists', 'absent');
    return diffs;
  }

  // Base key schema.
  const expectedBase = baseKeySchema(decl)
    .map(k => `${k.AttributeName}:${k.KeyType}`)
    .join(',');
  const actualBase = (live.KeySchema || []).map(k => `${k.AttributeName}:${k.KeyType}`).join(',');
  if (expectedBase !== actualBase) {
    addDiff(diffs, 'table.KeySchema', 'error', expectedBase, actualBase);
  }

  // Attribute types for each declared key (base + every index key).
  const expectedAttrs = new Map();
  expectedAttrs.set(decl.keyFields[0].name, attributeType(decl.keyFields[0].type));
  if (decl.structuralKey) expectedAttrs.set(decl.structuralKey.name, 'S');
  const {gsi: declGsi, lsi: declLsi} = splitIndices(decl);
  for (const {idx} of declGsi) {
    expectedAttrs.set(idx.pk.name, attributeType(idx.pk.type));
    if (idx.sk) expectedAttrs.set(idx.sk.name, attributeType(idx.sk.type));
  }
  for (const {idx} of declLsi) {
    expectedAttrs.set(idx.sk.name, attributeType(idx.sk.type));
  }
  const actualAttrs = new Map((live.AttributeDefinitions || []).map(a => [a.AttributeName, a.AttributeType]));
  for (const [name, type] of expectedAttrs) {
    if (!actualAttrs.has(name)) {
      addDiff(diffs, `table.AttributeDefinitions.${name}`, 'error', fromAttributeType(type), 'absent');
    } else if (actualAttrs.get(name) !== type) {
      addDiff(diffs, `table.AttributeDefinitions.${name}`, 'error', fromAttributeType(type), fromAttributeType(actualAttrs.get(name)));
    }
  }

  // GSI comparisons.
  const liveGsi = new Map((live.GlobalSecondaryIndexes || []).map(g => [g.IndexName, g]));
  for (const {name, idx} of declGsi) {
    const live = liveGsi.get(name);
    if (!live) {
      addDiff(diffs, `gsi.${name}`, 'error', 'declared', 'absent');
      continue;
    }
    compareIndex(decl, idx, live, 'gsi', diffs);
    liveGsi.delete(name);
  }
  for (const name of liveGsi.keys()) {
    addDiff(diffs, `gsi.${name}`, 'warn', 'absent from declaration', 'present in table');
  }

  // LSI comparisons.
  const liveLsi = new Map((live.LocalSecondaryIndexes || []).map(l => [l.IndexName, l]));
  for (const {name, idx} of declLsi) {
    const live = liveLsi.get(name);
    if (!live) {
      addDiff(diffs, `lsi.${name}`, 'error', 'declared', 'absent');
      continue;
    }
    compareIndex(decl, idx, live, 'lsi', diffs);
    liveLsi.delete(name);
  }
  for (const name of liveLsi.keys()) {
    addDiff(diffs, `lsi.${name}`, 'warn', 'absent from declaration', 'present in table');
  }

  // Billing / stream — compared only when declared on the adapter.
  if (decl.billingMode === 'PROVISIONED' && live.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST') {
    addDiff(diffs, 'table.BillingMode', 'error', 'PROVISIONED', 'PAY_PER_REQUEST');
  } else if (decl.billingMode === 'PAY_PER_REQUEST' && live.BillingModeSummary?.BillingMode === 'PROVISIONED') {
    addDiff(diffs, 'table.BillingMode', 'warn', 'PAY_PER_REQUEST', 'PROVISIONED');
  }
  if (decl.streamSpecification) {
    const liveStream = live.StreamSpecification || {};
    if (decl.streamSpecification.StreamEnabled !== (liveStream.StreamEnabled === true)) {
      addDiff(diffs, 'table.StreamSpecification.StreamEnabled', 'error', decl.streamSpecification.StreamEnabled, liveStream.StreamEnabled === true);
    }
    if (decl.streamSpecification.StreamViewType && liveStream.StreamViewType !== decl.streamSpecification.StreamViewType) {
      addDiff(diffs, 'table.StreamSpecification.StreamViewType', 'error', decl.streamSpecification.StreamViewType, liveStream.StreamViewType);
    }
  }

  return diffs;
};

/**
 * verifyTable(adapterOrDeclaration, options?)
 *
 * - Compares declared key schema + GSI/LSI specs against DescribeTable.
 * - Billing / stream config compared only when declared on the adapter.
 * - When `descriptorKey` is declared, reads the reserved-record descriptor
 *   and diffs it against the current declaration. Absent descriptor is a
 *   `warn` only when `{requireDescriptor: true}` is passed — otherwise
 *   silent (IaC-managed tables have no descriptor by default).
 * - `{throwOnMismatch: true}` → throws `TableVerificationFailed` when any
 *   `error`-severity diff is present. Otherwise returns `{ok, diffs}`.
 */
export const verifyTable = async (adapterOrDeclaration, options = {}) => {
  const decl = extractDeclaration(adapterOrDeclaration);
  const live = await describeTable(decl.client, decl.table);
  const diffs = diffTable(decl, live);

  if (live && decl.descriptorKey) {
    const stored = await readDescriptor(decl);
    if (stored) {
      diffs.push(...compareDescriptor(stored, decl));
    } else if (options.requireDescriptor) {
      addDiff(diffs, 'descriptor', 'error', 'present', 'absent');
    }
  }

  const hasError = diffs.some(d => d.severity === 'error');
  const ok = !hasError;

  if (options.throwOnMismatch && hasError) {
    throw new TableVerificationFailed(decl.table, diffs);
  }

  return {ok, diffs};
};
