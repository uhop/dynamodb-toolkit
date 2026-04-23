// Opt-in reserved-record descriptor. Writes a JSON snapshot of the
// adapter declaration at `{keyFields[0]: descriptorKey}` (structuralKey
// derived from that single component when composite). Detects drift
// `DescribeTable` cannot see: marshalling helpers in use, search-mirror
// field names, `filterable` allowlist, etc.
//
// Absent descriptor is neutral by default — IaC-managed tables never
// had the toolkit write one, and treating absence as failure would
// break every Terraform / CDK deployment. `{requireDescriptor: true}`
// on verifyTable opts into strictness.

import {GetCommand, PutCommand} from '@aws-sdk/lib-dynamodb';

export const DESCRIPTOR_VERSION = 1;

// Attribute name under which the JSON snapshot is stored on the
// descriptor record. Intentionally boring — avoids collision with any
// real attribute users might carry.
const DESCRIPTOR_ATTR = '__toolkit_descriptor__';

// Build the DB-shaped key for the descriptor record. Mirrors the shape
// the Adapter's `_builtInPrepareKey` would produce for a single-element
// key object with only keyFields[0] set.
export const descriptorRecordKey = decl => {
  if (!decl.descriptorKey) {
    throw new Error('descriptorRecordKey: declaration has no descriptorKey set');
  }
  const key = {[decl.keyFields[0].name]: decl.descriptorKey};
  if (decl.structuralKey) {
    key[decl.structuralKey.name] = decl.descriptorKey;
  }
  return key;
};

// Snapshot the parts of the declaration a user would want to verify
// post-facto. Keys pulled from the descriptor record MUST be stable
// across adapter versions for round-trip verification to work.
export const buildDescriptorSnapshot = decl => ({
  version: DESCRIPTOR_VERSION,
  generatedAt: new Date().toISOString(),
  table: decl.table,
  keyFields: decl.keyFields.map(f => ({name: f.name, type: f.type, ...(f.width !== undefined ? {width: f.width} : {})})),
  structuralKey: decl.structuralKey || null,
  indices: Object.fromEntries(
    Object.entries(decl.indices || {}).map(([name, idx]) => [
      name,
      {
        type: idx.type,
        ...(idx.pk ? {pk: {name: idx.pk.name, type: idx.pk.type}} : {}),
        ...(idx.sk ? {sk: {name: idx.sk.name, type: idx.sk.type}} : {}),
        projection: Array.isArray(idx.projection) ? idx.projection.slice() : idx.projection,
        sparse: typeof idx.sparse === 'object' ? {onlyWhen: '<function>'} : idx.sparse,
        indirect: idx.indirect === true
      }
    ])
  ),
  typeLabels: decl.typeLabels || null,
  typeDiscriminator: decl.typeDiscriminator || null,
  filterable: decl.filterable || {},
  searchable: decl.searchable ? Object.keys(decl.searchable).sort() : [],
  searchablePrefix: decl.searchablePrefix || null,
  versionField: decl.versionField || null,
  createdAtField: decl.createdAtField || null,
  technicalPrefix: decl.technicalPrefix || null,
  relationships: decl.relationships || null
});

// Read the descriptor record. Returns the parsed snapshot or `null` when
// the record is absent (not an error by default — see module comment).
export const readDescriptor = async decl => {
  if (!decl.descriptorKey) return null;
  const out = await decl.client.send(new GetCommand({TableName: decl.table, Key: descriptorRecordKey(decl)}));
  if (!out.Item) return null;
  const raw = out.Item[DESCRIPTOR_ATTR];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

// Write the descriptor record unconditionally (overwrite-on-write — the
// snapshot is the declaration at call time). `generatedAt` always
// updates.
export const writeDescriptor = async decl => {
  if (!decl.descriptorKey) {
    throw new Error('writeDescriptor: declaration has no descriptorKey set');
  }
  const snapshot = buildDescriptorSnapshot(decl);
  const item = {...descriptorRecordKey(decl), [DESCRIPTOR_ATTR]: JSON.stringify(snapshot)};
  await decl.client.send(new PutCommand({TableName: decl.table, Item: item}));
  return snapshot;
};

// Compare a stored descriptor against the current declaration. Produces
// a diffs array with the same shape verifyTable uses. `generatedAt` and
// `version` are not compared (expected to differ across writes).
export const compareDescriptor = (stored, decl) => {
  const current = buildDescriptorSnapshot(decl);
  const diffs = [];
  const scalarFields = [
    'table',
    'structuralKey',
    'typeLabels',
    'typeDiscriminator',
    'searchablePrefix',
    'versionField',
    'createdAtField',
    'technicalPrefix',
    'relationships'
  ];
  for (const f of scalarFields) {
    if (!deepEqual(stored[f], current[f])) {
      diffs.push({
        path: `descriptor.${f}`,
        severity: 'warn',
        expected: current[f],
        actual: stored[f]
      });
    }
  }
  if (!deepEqual(stored.keyFields, current.keyFields)) {
    diffs.push({path: 'descriptor.keyFields', severity: 'warn', expected: current.keyFields, actual: stored.keyFields});
  }
  if (!deepEqual(stored.indices, current.indices)) {
    diffs.push({path: 'descriptor.indices', severity: 'warn', expected: current.indices, actual: stored.indices});
  }
  if (!deepEqual(stored.filterable, current.filterable)) {
    diffs.push({path: 'descriptor.filterable', severity: 'warn', expected: current.filterable, actual: stored.filterable});
  }
  if (!deepEqual(stored.searchable, current.searchable)) {
    diffs.push({path: 'descriptor.searchable', severity: 'warn', expected: current.searchable, actual: stored.searchable});
  }
  return diffs;
};

// Structural equality for JSON-safe values (scalars, arrays, plain
// objects). Used for descriptor diffs — values here are snapshot-safe
// (arrays/objects/primitives, no Date/Set/Map).
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; ++i) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a),
    bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
};
