// Normalize an Adapter instance or an adapter-shaped declaration object
// into the shape the provisioning helpers consume. Provisioning never
// runs hook composition or hits DynamoDB on its own — it needs the
// declaration (what tables / indices the adapter wants) plus a client to
// talk to.
//
// Accepts either an Adapter instance (post-construction — all fields
// already normalized) or any object that shares the same public fields.
// The shape:
//
//   - `client`          — DynamoDBDocumentClient or DynamoDBClient.
//   - `table`           — table name.
//   - `keyFields`       — [{name, type, width?}, ...] (normalized).
//   - `structuralKey?`  — {name, separator} or undefined (single-field keys).
//   - `indices?`        — {name: {type, pk?, sk?, projection, sparse, indirect}}.
//   - Informational fields mirrored into the descriptor record when opted in:
//     `typeLabels`, `typeDiscriminator`, `filterable`, `searchable`,
//     `searchablePrefix`, `versionField`, `createdAtField`,
//     `technicalPrefix`, `relationships`, `descriptorKey`.
//   - Provisioning-specific overrides (optional):
//     `billingMode?`             — 'PAY_PER_REQUEST' | 'PROVISIONED', default 'PAY_PER_REQUEST'.
//     `provisionedThroughput?`   — {ReadCapacityUnits, WriteCapacityUnits}.
//     `streamSpecification?`     — {StreamEnabled, StreamViewType}.

const REQUIRED_FIELDS = ['client', 'table', 'keyFields'];

export const extractDeclaration = source => {
  if (!source || typeof source !== 'object') {
    throw new Error('extractDeclaration: argument must be an Adapter instance or a declaration object');
  }
  for (const f of REQUIRED_FIELDS) {
    if (source[f] === undefined || source[f] === null) {
      throw new Error(`extractDeclaration: source is missing required field '${f}'`);
    }
  }
  return {
    client: source.client,
    table: source.table,
    keyFields: source.keyFields,
    structuralKey: source.structuralKey,
    indices: source.indices || {},
    typeLabels: source.typeLabels,
    typeDiscriminator: source.typeDiscriminator,
    filterable: source.filterable || {},
    searchable: source.searchable || {},
    searchablePrefix: source.searchablePrefix,
    versionField: source.versionField,
    createdAtField: source.createdAtField,
    technicalPrefix: source.technicalPrefix,
    relationships: source.relationships,
    descriptorKey: source.descriptorKey,
    billingMode: source.billingMode || 'PAY_PER_REQUEST',
    provisionedThroughput: source.provisionedThroughput,
    streamSpecification: source.streamSpecification
  };
};

// Map a toolkit key type ('string' | 'number' | 'binary') to DynamoDB's
// AttributeType ('S' | 'N' | 'B').
export const attributeType = t => {
  if (t === 'string') return 'S';
  if (t === 'number') return 'N';
  if (t === 'binary') return 'B';
  throw new Error(`attributeType: unknown key type '${t}'`);
};

// Inverse — DynamoDB AttributeType to toolkit key type.
export const fromAttributeType = a => {
  if (a === 'S') return 'string';
  if (a === 'N') return 'number';
  if (a === 'B') return 'binary';
  throw new Error(`fromAttributeType: unknown AttributeType '${a}'`);
};

// Map a toolkit projection ('all' | 'keys-only' | string[]) to DynamoDB's
// Projection shape.
export const toProjection = projection => {
  if (projection === 'all') return {ProjectionType: 'ALL'};
  if (projection === 'keys-only') return {ProjectionType: 'KEYS_ONLY'};
  if (Array.isArray(projection)) {
    return {ProjectionType: 'INCLUDE', NonKeyAttributes: projection.slice()};
  }
  throw new Error(`toProjection: unknown projection '${projection}'`);
};

// Inverse — DynamoDB Projection shape to toolkit projection. Arrays are
// sorted for deterministic comparison against the declaration.
export const fromProjection = p => {
  if (!p) return 'all';
  if (p.ProjectionType === 'ALL') return 'all';
  if (p.ProjectionType === 'KEYS_ONLY') return 'keys-only';
  if (p.ProjectionType === 'INCLUDE') return (p.NonKeyAttributes || []).slice();
  throw new Error(`fromProjection: unknown ProjectionType '${p.ProjectionType}'`);
};

// Base-table key-schema in DynamoDB's CreateTable shape, derived from the
// declaration. Partition key = keyFields[0]. Sort key = structuralKey
// (composite) or keyFields[1] if present without structuralKey (single
// legacy field), otherwise absent.
export const baseKeySchema = decl => {
  const schema = [{AttributeName: decl.keyFields[0].name, KeyType: 'HASH'}];
  if (decl.structuralKey) {
    schema.push({AttributeName: decl.structuralKey.name, KeyType: 'RANGE'});
  }
  return schema;
};

// AttributeDefinitions for CreateTable — union of base-table keys and
// every declared index's keys. Deduplicated by AttributeName; types must
// agree across occurrences or construction rejects.
export const attributeDefinitions = decl => {
  const out = new Map();
  const add = (name, type) => {
    if (out.has(name)) {
      if (out.get(name) !== type) {
        throw new Error(`attributeDefinitions: conflicting AttributeType for '${name}' — '${out.get(name)}' vs '${type}'`);
      }
      return;
    }
    out.set(name, type);
  };

  add(decl.keyFields[0].name, attributeType(decl.keyFields[0].type));
  if (decl.structuralKey) {
    // Structural key attribute always 'S' (string) — the composite join
    // produces a string regardless of the component types.
    add(decl.structuralKey.name, 'S');
  }

  for (const name of Object.keys(decl.indices || {})) {
    const idx = decl.indices[name];
    if (idx.type === 'gsi') {
      add(idx.pk.name, attributeType(idx.pk.type));
      if (idx.sk) add(idx.sk.name, attributeType(idx.sk.type));
    } else if (idx.type === 'lsi') {
      add(idx.sk.name, attributeType(idx.sk.type));
    }
  }

  return [...out.entries()].map(([AttributeName, AttributeType]) => ({AttributeName, AttributeType}));
};

// Index key-schema for CreateTable / UpdateTable. LSIs inherit the base-
// table partition key.
export const indexKeySchema = (decl, idx) => {
  if (idx.type === 'gsi') {
    const schema = [{AttributeName: idx.pk.name, KeyType: 'HASH'}];
    if (idx.sk) schema.push({AttributeName: idx.sk.name, KeyType: 'RANGE'});
    return schema;
  }
  return [
    {AttributeName: decl.keyFields[0].name, KeyType: 'HASH'},
    {AttributeName: idx.sk.name, KeyType: 'RANGE'}
  ];
};

// Partition GSIs and LSIs out of the indices map; skip `indirect`-only
// entries (legacy `indirectIndices` that have no pk declared — toolkit
// routes to them by name only, not provisioning-declared).
export const splitIndices = decl => {
  const gsi = [];
  const lsi = [];
  for (const name of Object.keys(decl.indices || {})) {
    const idx = decl.indices[name];
    if (idx.type === 'gsi') {
      if (!idx.pk) continue;
      gsi.push({name, idx});
    } else if (idx.type === 'lsi') {
      lsi.push({name, idx});
    }
  }
  return {gsi, lsi};
};
