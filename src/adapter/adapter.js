// Adapter — composition root tying expressions, batch, mass, paths, and hooks together.

import {GetCommand, PutCommand, DeleteCommand} from '@aws-sdk/lib-dynamodb';

import {Raw} from '../raw.js';
import {addProjection} from '../expressions/projection.js';
import {buildUpdate} from '../expressions/update.js';
import {buildCondition} from '../expressions/condition.js';
import {buildKeyCondition} from '../expressions/key-condition.js';
import {buildFilter} from '../expressions/filter.js';
import {cleanParams} from '../expressions/clean-params.js';
import {cloneParams} from '../expressions/clone-params.js';

import {applyBatch} from '../batch/apply-batch.js';
import {applyTransaction} from '../batch/apply-transaction.js';

import {paginateList} from '../mass/paginate-list.js';
import {readByKeys} from '../mass/read-by-keys.js';
import {writeItems} from '../mass/write-items.js';
import {mergeMapFn} from '../mass/map-fns.js';
import {deleteByKeys} from '../mass/delete-list.js';
import {runPaged} from '../mass/run-paged.js';

import {defaultHooks, restrictKey} from './hooks.js';
import {dispatchWrite} from './transaction-upgrade.js';
import {ConsistentReadOnGSIRejected, NoIndexForSortField, BadFilterField, BadFilterOp, KeyFieldChanged, CreatedAtFieldNotDeclared, CascadeNotDeclared} from '../errors.js';

const MOVE_CHUNK = 12;

// AWS SDK CCF ("ConditionalCheckFailedException") is the signal for
// ifNotExists / ifExists. Detected by .name because the DocumentClient
// exposes the error class identity differently across versions /
// bundlers, but `.name` is stable.
const isConditionFailure = err => err && (err.name === 'ConditionalCheckFailedException' || err.__type === 'ConditionalCheckFailedException');

// Map an SDK error to a `MassOpFailureReason` enum value. Unmapped
// errors fall through to `'Unknown'`; the original error is preserved
// on `sdkError`.
const classifyMassOpError = err => {
  const name = err?.name;
  if (name === 'ConditionalCheckFailedException') return 'ConditionalCheckFailed';
  if (name === 'ValidationException') return 'ValidationException';
  if (name === 'ProvisionedThroughputExceededException') return 'ProvisionedThroughputExceeded';
  return 'Unknown';
};

// Deep-equality for DynamoDB attribute values: scalars, arrays, plain
// objects, Sets. Used by `edit()` to suppress SET clauses for unchanged
// fields. Not a general-purpose equality — e.g., Binary (Uint8Array) in
// Sets won't compare structurally, but no-op SETs on binaries only
// cost a wasted WCU, not correctness.
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Set) return b instanceof Set && a.size === b.size && [...a].every(v => b.has(v));
  if (b instanceof Set) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (Array.isArray(b)) return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
};

// Closed op vocabulary for the `f-<field>-<op>=<value>` filter grammar.
// Kept in sync with the rest-core `parseFFilter` parser's op set.
const ALL_F_OPS = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in', 'btw', 'beg', 'ct', 'ex', 'nx']);
const F_OP_COMPARISON = {eq: '=', ne: '<>', lt: '<', le: '<=', gt: '>', ge: '>='};
const F_OP_NO_VALUE = new Set(['ex', 'nx']);

// Normalize an index-key entry (GSI/LSI pk or sk) — accepts a bare string or
// a `{name, type?}` descriptor. Width is not applicable to index keys (no
// joining on them — DynamoDB sorts natively by declared type).
const normalizeIndexKey = (entry, ctx) => {
  if (typeof entry === 'string') return {name: entry, type: 'string'};
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
    throw new Error(`${ctx} must be a string or {name, type?}`);
  }
  const type = entry.type || 'string';
  if (type !== 'string' && type !== 'number' && type !== 'binary') {
    throw new Error(`${ctx}.type must be 'string' | 'number' | 'binary'`);
  }
  return {name: entry.name, type};
};

// Normalize one entry from the `indices` declaration map. Validates shape +
// fills defaults (`projection: 'all'`, `sparse: false`, `indirect: false`).
const normalizeIndex = (name, def) => {
  if (!def || typeof def !== 'object') {
    throw new Error(`options.indices['${name}'] must be an object`);
  }
  const type = def.type;
  if (type !== 'gsi' && type !== 'lsi') {
    throw new Error(`options.indices['${name}'].type must be 'gsi' | 'lsi'`);
  }
  const out = {type};
  if (type === 'gsi') {
    if (def.pk === undefined) {
      throw new Error(`options.indices['${name}'] (gsi) requires pk`);
    }
    out.pk = normalizeIndexKey(def.pk, `options.indices['${name}'].pk`);
    if (def.sk !== undefined) {
      out.sk = normalizeIndexKey(def.sk, `options.indices['${name}'].sk`);
    }
  } else {
    // lsi — inherits base table's partition key; only alternate sort is declared.
    if (def.pk !== undefined) {
      throw new Error(
        `options.indices['${name}'] (lsi) does not accept pk — LSIs inherit the base table's partition key`
      );
    }
    if (def.sk === undefined) {
      throw new Error(`options.indices['${name}'] (lsi) requires sk`);
    }
    out.sk = normalizeIndexKey(def.sk, `options.indices['${name}'].sk`);
  }
  const projection = def.projection === undefined ? 'all' : def.projection;
  if (
    projection !== 'all' &&
    projection !== 'keys-only' &&
    !(Array.isArray(projection) && projection.length > 0 && projection.every(f => typeof f === 'string'))
  ) {
    throw new Error(`options.indices['${name}'].projection must be 'all' | 'keys-only' | non-empty string[]`);
  }
  out.projection = Array.isArray(projection) ? projection.slice() : projection;
  if (def.sparse === undefined || def.sparse === false) {
    out.sparse = false;
  } else if (def.sparse === true) {
    out.sparse = true;
  } else if (def.sparse && typeof def.sparse === 'object' && typeof def.sparse.onlyWhen === 'function') {
    out.sparse = {onlyWhen: def.sparse.onlyWhen};
  } else {
    throw new Error(`options.indices['${name}'].sparse must be boolean or {onlyWhen: (item) => boolean}`);
  }
  out.indirect = def.indirect === true;
  return out;
};

// Normalize a keyFields entry — accepts a bare string or a full descriptor.
// Bare string `'state'` → `{name: 'state', type: 'string'}`.
const normalizeKeyFieldSpec = (entry, index, composite) => {
  if (typeof entry === 'string') return {name: entry, type: 'string'};
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
    throw new Error(`options.keyFields[${index}] must be a string or {name, type?, width?}`);
  }
  const type = entry.type || 'string';
  if (type !== 'string' && type !== 'number' && type !== 'binary') {
    throw new Error(`options.keyFields[${index}].type must be 'string' | 'number' | 'binary'`);
  }
  const field = {name: entry.name, type};
  if (entry.width !== undefined) {
    if (!Number.isInteger(entry.width) || entry.width < 1) {
      throw new Error(`options.keyFields[${index}].width must be a positive integer`);
    }
    field.width = entry.width;
  }
  // width is required for {type: 'number'} in composite keys — zero-padding
  // preserves lexicographic sort on the joined string key.
  if (composite && type === 'number' && field.width === undefined) {
    throw new Error(
      `options.keyFields[${index}] ({name: '${field.name}', type: 'number'}) requires 'width' in a composite keyFields`
    );
  }
  return field;
};

export class Adapter {
  constructor(options) {
    if (!options) throw new Error('AdapterOptions are required');
    if (!options.client) throw new Error('options.client (DynamoDBDocumentClient) is required');
    if (!options.table) throw new Error('options.table is required');
    if (!Array.isArray(options.keyFields) || !options.keyFields.length) {
      throw new Error('options.keyFields must be a non-empty array');
    }

    // Normalize typed keyFields descriptors — canonical typed array, each
    // entry `{field, type, width?}`. Bare-string inputs are normalized into
    // this shape. Callers reading just the name use `keyFields[i].name`.
    const composite = options.keyFields.length > 1;
    this.keyFields = options.keyFields.map((e, i) => normalizeKeyFieldSpec(e, i, composite));

    // Optional structuralKey declaration. Required when keyFields is composite
    // (more than one component) — the join shape is the only way to form a
    // sort key out of multiple component fields. Accepts string shorthand
    // `'-sk'` or full descriptor `{name, separator?}` (separator defaults
    // to `'|'`).
    if (options.structuralKey !== undefined) {
      let name, sep;
      if (typeof options.structuralKey === 'string') {
        if (options.structuralKey.length === 0) {
          throw new Error('options.structuralKey (string shorthand) must be non-empty');
        }
        name = options.structuralKey;
        sep = undefined;
      } else if (options.structuralKey && typeof options.structuralKey === 'object' && typeof options.structuralKey.name === 'string') {
        name = options.structuralKey.name;
        sep = options.structuralKey.separator;
        if (sep !== undefined && typeof sep !== 'string') {
          throw new Error('options.structuralKey.separator must be a string');
        }
      } else {
        throw new Error("options.structuralKey must be a string (shorthand for name) or {name: string, separator?: string}");
      }
      this.structuralKey = {name, separator: sep === undefined ? '|' : sep};
    } else if (composite) {
      throw new Error('options.structuralKey is required when options.keyFields is composite (length > 1)');
    }

    // Optional typeLabels — paired 1:1 with keyFields. Lets `adapter.typeOf`
    // return a named label instead of a raw depth number.
    if (options.typeLabels !== undefined) {
      if (!Array.isArray(options.typeLabels) || options.typeLabels.some(l => typeof l !== 'string')) {
        throw new Error('options.typeLabels must be an array of strings');
      }
      if (options.typeLabels.length !== this.keyFields.length) {
        throw new Error(
          `options.typeLabels length (${options.typeLabels.length}) must match keyFields length (${this.keyFields.length})`
        );
      }
      this.typeLabels = options.typeLabels.slice();
    }

    // Optional typeDiscriminator — overrides depth-based detection when the
    // named field is present on the item. Accepts string shorthand
    // `'kind'` or full descriptor `{name}`.
    if (options.typeDiscriminator !== undefined) {
      let discName;
      if (typeof options.typeDiscriminator === 'string') {
        if (options.typeDiscriminator.length === 0) {
          throw new Error('options.typeDiscriminator (string shorthand) must be non-empty');
        }
        discName = options.typeDiscriminator;
      } else if (
        options.typeDiscriminator &&
        typeof options.typeDiscriminator === 'object' &&
        typeof options.typeDiscriminator.name === 'string'
      ) {
        discName = options.typeDiscriminator.name;
      } else {
        throw new Error('options.typeDiscriminator must be a string (shorthand for name) or {name: string}');
      }
      this.typeDiscriminator = {name: discName};
    }

    // Optional technicalPrefix — when declared, marks fields that are
    // adapter-managed (structural key, search mirrors, sparse markers,
    // future versionField / createdAtField). Incoming user items are
    // rejected if they carry any field starting with this prefix; on read,
    // all such fields are stripped from items before the user's revive hook
    // sees them. Every adapter-managed field name must itself start with
    // this prefix (validated below).
    if (options.technicalPrefix !== undefined) {
      if (typeof options.technicalPrefix !== 'string' || options.technicalPrefix.length === 0) {
        throw new Error('options.technicalPrefix must be a non-empty string');
      }
      this.technicalPrefix = options.technicalPrefix;
    }

    // Optional versionField — optimistic-concurrency attribute.
    // Writes auto-condition on the stored version matching the item's
    // incoming version, and auto-increment on success. Must start with
    // technicalPrefix (validated below). Preserved across revive so
    // callers can round-trip the version through read-modify-write.
    if (options.versionField !== undefined) {
      if (typeof options.versionField !== 'string' || options.versionField.length === 0) {
        throw new Error('options.versionField must be a non-empty string');
      }
      this.versionField = options.versionField;
    }

    // Optional createdAtField — stores the item's creation timestamp.
    // Used by the `asOf` mass-op option to scope to items that existed
    // at a point in time (`<createdAtField> <= :asOf`). Toolkit does
    // NOT auto-write this field — the user's `prepare` hook is
    // responsible. Whatever format they write (epoch ms, ISO string,
    // epoch seconds) dictates what `asOf` must pass through. Date
    // instances are auto-converted to ISO 8601 as a convenience.
    if (options.createdAtField !== undefined) {
      if (typeof options.createdAtField !== 'string' || options.createdAtField.length === 0) {
        throw new Error('options.createdAtField must be a non-empty string');
      }
      this.createdAtField = options.createdAtField;
    }

    // Opt-in reserved-record descriptor key (T2, 3.6.0). When declared,
    // `ensureTable` and the first `verifyTable` write a JSON snapshot of
    // this adapter's declaration at `{keyFields[0]: descriptorKey}` so
    // subsequent `verifyTable` calls can detect drift beyond what
    // `DescribeTable` reports (marshalling helpers, search mirrors,
    // filterable allowlist, etc.). Default unset — IaC-managed tables
    // ignore this entirely.
    if (options.descriptorKey !== undefined) {
      if (typeof options.descriptorKey !== 'string' || options.descriptorKey.length === 0) {
        throw new Error('options.descriptorKey must be a non-empty string');
      }
      this.descriptorKey = options.descriptorKey;
    }

    this.client = options.client;
    this.table = options.table;
    this.projectionFieldMap = options.projectionFieldMap || {};
    this.searchable = options.searchable || {};
    this.searchablePrefix = options.searchablePrefix || '-search-';
    this.indirectIndices = options.indirectIndices || {};

    // `filterable` — allowlist for the `f-<field>-<op>=<value>` filter
    // grammar. Shape `{<fieldName>: ['eq', 'beg', ...]}`. Validated at
    // construction: every op string must be from the closed vocabulary.
    this.filterable = {};
    if (options.filterable !== undefined) {
      if (typeof options.filterable !== 'object' || options.filterable === null) {
        throw new Error('options.filterable must be a plain object');
      }
      for (const field of Object.keys(options.filterable)) {
        const ops = options.filterable[field];
        if (!Array.isArray(ops) || ops.length === 0) {
          throw new Error(`options.filterable['${field}'] must be a non-empty array of ops`);
        }
        for (const op of ops) {
          if (typeof op !== 'string' || !ALL_F_OPS.has(op)) {
            throw new Error(
              `options.filterable['${field}'] contains invalid op '${op}'. Allowed: ${[...ALL_F_OPS].join(', ')}`
            );
          }
        }
        this.filterable[field] = ops.slice();
      }
    }

    // Normalize the `indices` map. Legacy `indirectIndices: {name: 1}` entries
    // are synthesised into minimal `{type: 'gsi', indirect: true,
    // projection: 'keys-only'}` shapes — enough for the second-hop BatchGet
    // routing, without the pk/sk info that the new declaration carries
    // (legacy entries can't participate in sort inference or filter-grammar
    // type coercion; users who need those features migrate to `indices`).
    this.indices = {};
    if (options.indices !== undefined) {
      if (typeof options.indices !== 'object' || options.indices === null) {
        throw new Error('options.indices must be a plain object');
      }
      for (const name of Object.keys(options.indices)) {
        this.indices[name] = normalizeIndex(name, options.indices[name]);
      }
    }
    for (const name of Object.keys(this.indirectIndices)) {
      if (!this.indirectIndices[name]) continue;
      if (this.indices[name]) {
        // Already declared via `indices` — just ensure indirect=true.
        this.indices[name].indirect = true;
      } else {
        this.indices[name] = {type: 'gsi', indirect: true, projection: 'keys-only', sparse: false};
      }
    }

    // A6': parent-child relationship declaration for cascade primitives.
    // `{structural: true}` opts into treating the composite structural key
    // as a parent-child hierarchy. Without a declaration, cascade
    // primitives (`deleteAllUnder` / `cloneAllUnder` / `moveAllUnder`)
    // throw `CascadeNotDeclared`. The toolkit does not infer cascade
    // scope from composite `keyFields` alone — a composite key is a join
    // pattern, which is not the same as a parent-child declaration.
    this.relationships = null;
    if (options.relationships !== undefined) {
      if (typeof options.relationships !== 'object' || options.relationships === null) {
        throw new Error('options.relationships must be a plain object');
      }
      if (options.relationships.structural !== undefined && typeof options.relationships.structural !== 'boolean') {
        throw new Error('options.relationships.structural must be a boolean');
      }
      if (options.relationships.structural === true) {
        if (this.keyFields.length < 2 || !this.structuralKey) {
          throw new Error(
            'options.relationships.structural requires composite keyFields (length > 1) with a declared structuralKey'
          );
        }
      }
      this.relationships = {structural: Boolean(options.relationships.structural)};
    }

    // Validate that all adapter-managed field names start with technicalPrefix
    // (when declared). This guarantees revive-time stripping catches them
    // and prepare-time incoming-field validation rejects user collisions.
    if (this.technicalPrefix) {
      const prefix = this.technicalPrefix;
      if (this.structuralKey && !this.structuralKey.name.startsWith(prefix)) {
        throw new Error(
          `options.structuralKey.name '${this.structuralKey.name}' must start with options.technicalPrefix '${prefix}'`
        );
      }
      if (Object.keys(this.searchable).length && !this.searchablePrefix.startsWith(prefix)) {
        throw new Error(
          `options.searchablePrefix '${this.searchablePrefix}' must start with options.technicalPrefix '${prefix}'`
        );
      }
      if (this.versionField && !this.versionField.startsWith(prefix)) {
        throw new Error(
          `options.versionField '${this.versionField}' must start with options.technicalPrefix '${prefix}'`
        );
      }
      if (this.createdAtField && !this.createdAtField.startsWith(prefix)) {
        throw new Error(
          `options.createdAtField '${this.createdAtField}' must start with options.technicalPrefix '${prefix}'`
        );
      }
    } else {
      if (this.versionField) {
        throw new Error('options.versionField requires options.technicalPrefix to be declared');
      }
      if (this.createdAtField) {
        throw new Error('options.createdAtField requires options.technicalPrefix to be declared');
      }
    }

    // Compute the DB primary-key attribute names. With `structuralKey`
    // declared, the base table's sort key IS the structural-key field
    // (partition key = keyFields[0]). Without it, the partition key is the
    // only primary-key attribute — the whole keyFields is that one name.
    // Used by `_restrictKey` when extracting DB keys from items, and by
    // mass-op projections that need the primary-key attributes for deletes
    // and moves.
    this.primaryKeyAttrs = this.structuralKey
      ? [this.keyFields[0].name, this.structuralKey.name]
      : this.keyFields.map(f => f.name);

    // Hook composition: wrap the user's prepare / revive / prepareKey hooks
    // with built-in steps that run before the user hook. The inner built-in
    // step checks its own conditions — if `technicalPrefix`, `structuralKey`,
    // and `searchable` are all unset, the built-in steps are pure identity
    // and behaviour matches v3.1.2. Wrapping unconditionally avoids a
    // branching-on-features code path; the per-call overhead is one function
    // call per hook invocation.
    const userHooks = {...defaultHooks, ...(options.hooks || {})};
    const userPrepare = userHooks.prepare;
    const userRevive = userHooks.revive;
    const userPrepareKey = userHooks.prepareKey;
    // Invoke user hooks with `this` bound to the Adapter, so they can read
    // `this.searchable` / `this.keyFields` / `this.structuralKey` etc.
    // directly. Matches the intent of v3.1.2 user code that referenced
    // `this.searchable` (which happened to work by accident — v3.1.2 bound
    // `this` to `this.hooks` and the user's short-circuit `?.` swallowed the
    // undefined; now it's genuinely the Adapter instance).
    userHooks.prepare = (item, isPatch) => userPrepare.call(this, this._builtInPrepare(item, isPatch), isPatch);
    userHooks.revive = (rawItem, fields) => userRevive.call(this, this._builtInRevive(rawItem), fields);
    userHooks.prepareKey = (key, index) => userPrepareKey.call(this, this._builtInPrepareKey(key, index), index);
    this.hooks = userHooks;
  }

  // --- built-in prepare / revive steps (gated by technicalPrefix) ---

  /**
   * Validates incoming user fields (reject any starting with
   * `technicalPrefix`) and computes adapter-managed fields: the structural
   * key (from `keyFields`, contiguous-from-start rule) and searchable
   * mirrors. Runs before the user's `prepare` hook.
   *
   * For `put` / `post` (isPatch falsy), the structural key is written from
   * the full item's keyFields values. For `patch`, the structural key is
   * not touched (it's a primary-key attribute; DynamoDB rejects mutation
   * via `UpdateExpression`). Searchable mirrors ARE written for any
   * searchable field present in a patch payload.
   */
  _builtInPrepare(item, isPatch) {
    if (!item || typeof item !== 'object') return item;
    // Fast path: nothing declared, nothing to do — byte-for-byte identical
    // behaviour to v3.1.2.
    const hasSearchable = Object.keys(this.searchable).length > 0;
    if (!this.technicalPrefix && !this.structuralKey && !hasSearchable) return item;

    // 1. Reject incoming user fields that start with technicalPrefix.
    //    Exceptions: `versionField` and `createdAtField` are allowed —
    //    callers round-trip them through reads (for OC and for
    //    scope-freeze caller awareness).
    if (this.technicalPrefix) {
      const versionField = this.versionField;
      const createdAtField = this.createdAtField;
      for (const key of Object.keys(item)) {
        if (key.startsWith(this.technicalPrefix) && key !== versionField && key !== createdAtField) {
          throw new Error(
            `prepare: incoming field '${key}' starts with technicalPrefix '${this.technicalPrefix}' — this is an adapter-managed namespace and must not appear in caller items`
          );
        }
      }
    }

    const out = {...item};

    // 2. Structural key — full writes only. Patches can't change primary-key
    //    attributes via UpdateExpression, so skip. Single-field keyFields
    //    don't have a structural key (the key field itself is the sort key).
    if (!isPatch && this.structuralKey) {
      const components = [];
      for (const field of this.keyFields) {
        const v = item[field.name];
        if (v === undefined || v === null) break;
        components.push(this._formatKeyComponent(field, v));
      }
      if (components.length > 0) {
        out[this.structuralKey.name] = components.join(this.structuralKey.separator);
      }
    }

    // 3. Searchable mirrors — write for any searchable field present in
    //    item (works for full writes and patches alike).
    for (const searchField of Object.keys(this.searchable)) {
      const v = item[searchField];
      if (v !== undefined && v !== null) {
        out[this.searchablePrefix + searchField] = String(v).toLowerCase();
      }
    }

    return out;
  }

  /**
   * Strip every field whose name starts with `technicalPrefix` from the raw
   * item before the user's `revive` hook sees it. Keeps adapter-managed
   * implementation details off the wire. When `technicalPrefix` is unset,
   * this is a pass-through.
   *
   * Exception: `versionField` is preserved — callers round-trip it
   * through read-modify-write for optimistic concurrency. Writing it
   * back is how the toolkit knows which version the caller saw; the
   * auto-condition and auto-increment ride on its value.
   */
  _builtInRevive(rawItem) {
    if (!this.technicalPrefix || !rawItem || typeof rawItem !== 'object') return rawItem;
    const prefix = this.technicalPrefix;
    const versionField = this.versionField;
    const createdAtField = this.createdAtField;
    const out = {};
    for (const key of Object.keys(rawItem)) {
      if (!key.startsWith(prefix) || key === versionField || key === createdAtField) out[key] = rawItem[key];
    }
    return out;
  }

  /**
   * Compose the structural-key field on a read-key shape so DynamoDB
   * GetItem / DeleteItem / UpdateItem receive `{pk, sk}` where sk is the
   * structural key. Runs before the user's `prepareKey` hook.
   *
   * When the key is targeted at a secondary index (`index` set), this is
   * a pass-through — the GSI/LSI has its own key schema (declared in
   * `this.indices[index]`) that the user's `prepareKey` hook is
   * responsible for producing until declarative GSI-key composition
   * lands in a follow-up.
   *
   * When `structuralKey` isn't declared (single-field `keyFields`), this
   * is a pass-through — the sole keyField IS the sort/partition key.
   */
  _builtInPrepareKey(key, index) {
    if (!key || typeof key !== 'object') return key;
    if (index) return key;
    if (!this.structuralKey) return key;
    const components = [];
    for (const field of this.keyFields) {
      const v = key[field.name];
      if (v === undefined || v === null) break;
      components.push(this._formatKeyComponent(field, v));
    }
    if (components.length === 0) return key;
    return {
      ...key,
      [this.structuralKey.name]: components.join(this.structuralKey.separator)
    };
  }

  // --- type detection ---

  /**
   * Return the type label for an item, using (in priority order):
   *   1. `typeDiscriminator.name` value when present on the item.
   *   2. `typeLabels[depth - 1]` where depth = count of contiguous-from-start
   *      defined `keyFields` on the item, when `typeLabels` is declared.
   *   3. Raw depth number when no `typeLabels` is declared.
   *
   * Returns `undefined` when the item has no recognised type-signalling
   * fields at all (empty item, no discriminator, no keyFields present).
   */
  typeOf(item) {
    if (!item) return undefined;

    if (this.typeDiscriminator) {
      const v = item[this.typeDiscriminator.name];
      if (v !== undefined && v !== null) return '' + v;
    }

    // Count contiguous-from-start defined keyFields on the item.
    let depth = 0;
    for (const field of this.keyFields) {
      const v = item[field.name];
      if (v === undefined || v === null) break;
      depth++;
    }

    if (depth === 0) return undefined;
    if (this.typeLabels) return this.typeLabels[depth - 1];
    return depth;
  }

  // --- canned mapFn builders (Q23 follow-up) ---

  /**
   * Build a mapFn that swaps a leading keyFields prefix. Given
   * `srcPrefix = {state: 'TX'}` and `dstPrefix = {state: 'FL'}`, the returned
   * function rewrites each item's `state` field from `'TX'` to `'FL'`, leaving
   * all other keyFields and non-key data intact. Throws at construction when
   * the prefixes aren't contiguous-from-start or don't have matching keys,
   * and throws at apply time when an item doesn't actually match `srcPrefix`
   * (sign of a mis-scoped query upstream).
   */
  swapPrefix(srcPrefix, dstPrefix) {
    if (!srcPrefix || typeof srcPrefix !== 'object' || !dstPrefix || typeof dstPrefix !== 'object') {
      throw new Error('swapPrefix: both srcPrefix and dstPrefix must be objects');
    }
    const srcKeys = Object.keys(srcPrefix);
    const dstKeys = Object.keys(dstPrefix);
    if (srcKeys.length === 0) {
      throw new Error('swapPrefix: srcPrefix must name at least one keyField');
    }
    if (srcKeys.length !== dstKeys.length) {
      throw new Error('swapPrefix: srcPrefix and dstPrefix must name the same keyFields');
    }
    // Validate contiguous-from-start against keyFields, and same set of keys.
    for (let i = 0; i < srcKeys.length; i++) {
      const name = this.keyFields[i].name;
      if (srcKeys[i] !== name || dstKeys[i] !== name) {
        throw new Error(
          `swapPrefix: both prefixes must be contiguous-from-start — expected '${name}' at position ${i}, got src='${srcKeys[i]}', dst='${dstKeys[i]}'`
        );
      }
    }
    // Snapshot arrays so runtime apply doesn't re-read Object.keys order.
    const fields = srcKeys.slice();
    const src = {};
    const dst = {};
    for (const f of fields) {
      src[f] = srcPrefix[f];
      dst[f] = dstPrefix[f];
    }
    return item => {
      if (!item) return item;
      for (const f of fields) {
        if (item[f] !== src[f]) {
          throw new Error(
            `swapPrefix: item does not match srcPrefix — expected '${f}' === ${JSON.stringify(src[f])}, got ${JSON.stringify(item[f])}`
          );
        }
      }
      return {...item, ...dst};
    };
  }

  /**
   * Build a mapFn that merges a static overlay object into each item.
   * `{...item, ...obj}` — `obj`'s values win. If `obj` touches a keyField,
   * the destination structural key shifts accordingly. Validates that the
   * overlay doesn't set any keyField to `undefined` / `null` (which would
   * break destination-key formation).
   */
  overlayFields(obj) {
    if (!obj || typeof obj !== 'object') {
      throw new Error('overlayFields: overlay must be an object');
    }
    for (const field of this.keyFields) {
      const name = field.name;
      if (name in obj && (obj[name] === undefined || obj[name] === null)) {
        throw new Error(`overlayFields: cannot set keyField '${name}' to ${obj[name]} — would break destination key`);
      }
    }
    // Snapshot the overlay so later mutations of the caller's object don't affect behaviour.
    const overlay = {...obj};
    return item => (item ? {...item, ...overlay} : item);
  }

  // --- key builders (A1' / Q12) ---

  /**
   * Format a single keyFields value per its declared field: numbers get
   * zero-padded to `width` (required in composite keyFields), strings pass
   * through, binary values are coerced via String().
   */
  _formatKeyComponent(field, value) {
    if (field.type === 'number') {
      if (field.width !== undefined) {
        return String(value).padStart(field.width, '0');
      }
      return String(value);
    }
    return String(value);
  }

  /**
   * Build a KeyConditionExpression for a Query against this Adapter's main
   * table. Validates `values` contiguous-from-start against `keyFields`;
   * joins with the declared `structuralKey.separator`; calls the
   * `buildKeyCondition` primitive with the computed prefix.
   *
   * @param values Object keyed by `keyFields` names (contiguous-from-start).
   * @param options `{kind?, partial?, indexName?}` — `kind` defaults to
   *   `'exact'` when no `partial`, `'partial'` when `partial` is present.
   *   `'children'` must be explicit. `indexName` currently reserved for
   *   future declarative-GSI support (throws if set on this release).
   * @param params Optional existing params to merge into.
   * @returns The same `params` with `KeyConditionExpression` set.
   */
  buildKey(values, options = {}, params = {}) {
    if (!values || typeof values !== 'object') {
      throw new Error('buildKey(values): values must be an object keyed by keyFields names');
    }
    if (options.indexName !== undefined) {
      // Declarative-GSI surface for buildKey lands with the `indices` config
      // in a follow-up chunk. For now, users targeting GSIs with their own
      // structural keys invoke the buildKeyCondition primitive directly.
      throw new Error('buildKey({indexName}) is not yet supported — use buildKeyCondition primitive for GSI targets');
    }

    const {kind: kindOpt, partial} = options;
    const kind =
      kindOpt === undefined
        ? partial !== undefined
          ? 'partial'
          : 'exact'
        : kindOpt;
    if (kind !== 'exact' && kind !== 'children' && kind !== 'partial') {
      throw new Error(`buildKey: unknown kind '${kind}' — expected 'exact' | 'children' | 'partial'`);
    }

    // Walk keyFields, collect contiguous-from-start defined values.
    const components = [];
    let gapSeen = false;
    for (const field of this.keyFields) {
      const v = values[field.name];
      if (v === undefined || v === null) {
        gapSeen = true;
        continue;
      }
      if (gapSeen) {
        throw new Error(
          `buildKey: values are non-contiguous — '${field.name}' present but a preceding keyField is missing`
        );
      }
      components.push(this._formatKeyComponent(field, v));
    }
    if (components.length === 0) {
      throw new Error('buildKey: at least the partition keyField must be present in values');
    }

    // Single-field keyFields: direct equality on the lone key.
    if (this.keyFields.length === 1 || !this.structuralKey) {
      if (kind === 'children' || kind === 'partial') {
        throw new Error(`buildKey: kind '${kind}' requires a structuralKey declaration (composite keyFields)`);
      }
      return buildKeyCondition({name: this.keyFields[0].name, value: components[0], kind: 'exact'}, params);
    }

    // Composite keyFields → join into structuralKey.name.
    //
    // DynamoDB's Query requires BOTH the partition-key equality AND the
    // optional sort-key condition in the same KeyConditionExpression —
    // otherwise it rejects with "Query condition missed key schema
    // element". The primitive's `pkName` / `pkValue` knobs let us emit
    // both clauses in one call.
    const sep = this.structuralKey.separator;
    const base = components.join(sep);
    const pkName = this.keyFields[0].name;
    const pkValue = components[0];
    if (kind === 'exact') {
      return buildKeyCondition(
        {name: this.structuralKey.name, value: base, kind: 'exact', pkName, pkValue},
        params
      );
    }
    if (kind === 'children') {
      return buildKeyCondition(
        {name: this.structuralKey.name, value: base + sep, kind: 'prefix', pkName, pkValue},
        params
      );
    }
    // kind === 'partial'
    if (typeof partial !== 'string' || partial.length === 0) {
      throw new Error("buildKey: kind 'partial' requires options.partial to be a non-empty string");
    }
    return buildKeyCondition(
      {name: this.structuralKey.name, value: base + sep + partial, kind: 'prefix', pkName, pkValue},
      params
    );
  }

  // --- internal helpers ---

  _cloneParams(params) {
    const p = cloneParams(params || {});
    p.TableName = this.table;
    return p;
  }

  _restrictKey(rawKey) {
    return restrictKey(rawKey, this.primaryKeyAttrs);
  }

  _toKey(key, index) {
    if (key instanceof Raw) return this._restrictKey(key.item);
    return this._restrictKey(this.hooks.prepareKey(key, index));
  }

  _prepareItem(item, isPatch) {
    if (item instanceof Raw) return item.item;
    return this.hooks.prepare(item, isPatch);
  }

  async _validate(item, isPatch) {
    if (item instanceof Raw) return;
    await this.hooks.validateItem(item, isPatch);
  }

  _reviveOne(rawItem, fields, options) {
    if (!rawItem) return undefined;
    if (options?.reviveItems === false) return new Raw(rawItem);
    return this.hooks.revive(rawItem, fields);
  }

  // Inject / bump the versionField on an outgoing item. First writes
  // (observed === undefined) get version 1; subsequent writes get
  // observed + 1. Returns the observed value so callers can use it in
  // the ConditionExpression. No-op when `versionField` is unset.
  _applyVersionToItem(item) {
    if (!this.versionField || !item || typeof item !== 'object') return {item, observed: undefined};
    const current = item[this.versionField];
    const observed = current === undefined || current === null ? undefined : Number(current);
    const next = observed === undefined ? 1 : observed + 1;
    return {item: {...item, [this.versionField]: next}, observed};
  }

  // Merge the optimistic-concurrency condition
  // `attribute_not_exists(<pk>) OR <versionField> = :v` into params.
  // When `observed` is undefined (first write), we still emit the
  // `attribute_not_exists` guard so a racing insert by another writer
  // surfaces as a CCF. When `observed` is a number, the `OR` branch
  // lets the write succeed on a still-present item with the matching
  // version. Caller-supplied conditions AND-compose on top.
  _addVersionCondition(params, observed) {
    if (!this.versionField) return params;
    const names = params.ExpressionAttributeNames || {};
    const values = params.ExpressionAttributeValues || {};
    const pkAlias = '#vfpk' + Object.keys(names).length;
    names[pkAlias] = this.keyFields[0].name;

    let condition;
    if (observed === undefined) {
      condition = `attribute_not_exists(${pkAlias})`;
    } else {
      const vfAlias = '#vf' + Object.keys(names).length;
      names[vfAlias] = this.versionField;
      const vAlias = ':vfv' + Object.keys(values).length;
      values[vAlias] = observed;
      params.ExpressionAttributeValues = values;
      condition = `attribute_not_exists(${pkAlias}) OR ${vfAlias} = ${vAlias}`;
    }
    params.ExpressionAttributeNames = names;

    params.ConditionExpression = params.ConditionExpression
      ? `(${condition}) AND (${params.ConditionExpression})`
      : condition;
    return params;
  }

  // AND-merge `<createdAtField> <= :asOf` into FilterExpression for a
  // mass-op scope-freeze. `asOf` accepts Date (auto-converted to ISO
  // 8601), string, or number — toolkit passes scalar through, so the
  // caller's chosen storage format drives the comparison. Throws
  // `CreatedAtFieldNotDeclared` when `asOf` is supplied without the
  // adapter opting in.
  _applyAsOf(params, asOf) {
    if (asOf === undefined || asOf === null) return params;
    if (!this.createdAtField) throw new CreatedAtFieldNotDeclared();

    const value = asOf instanceof Date ? asOf.toISOString() : asOf;
    const names = params.ExpressionAttributeNames || {};
    const values = params.ExpressionAttributeValues || {};
    const nameAlias = '#asOfn' + Object.keys(names).length;
    const valueAlias = ':asOfv' + Object.keys(values).length;
    names[nameAlias] = this.createdAtField;
    values[valueAlias] = value;
    params.ExpressionAttributeNames = names;
    params.ExpressionAttributeValues = values;

    const filter = `${nameAlias} <= ${valueAlias}`;
    params.FilterExpression = params.FilterExpression ? `(${filter}) AND (${params.FilterExpression})` : filter;
    return params;
  }

  // Append `ADD <versionField> :1` to an UpdateExpression. DynamoDB's
  // ADD action initialises a missing numeric attribute to 0 before
  // adding, so a first-time patch correctly produces version = 1.
  _addVersionIncrement(params) {
    if (!this.versionField) return params;
    const names = params.ExpressionAttributeNames || {};
    const values = params.ExpressionAttributeValues || {};
    const vfAlias = '#vfinc' + Object.keys(names).length;
    names[vfAlias] = this.versionField;
    const oneAlias = ':vfone' + Object.keys(values).length;
    values[oneAlias] = 1;
    params.ExpressionAttributeNames = names;
    params.ExpressionAttributeValues = values;
    const clause = `${vfAlias} ${oneAlias}`;
    const expr = params.UpdateExpression || '';
    // Compose with any existing ADD clause; otherwise append ADD <clause>.
    const addMatch = /(^|\s)ADD\s+([^]*?)(?=\s(SET|REMOVE|DELETE)\s|$)/i.exec(expr);
    if (addMatch) {
      const insertAt = addMatch.index + addMatch[0].length;
      params.UpdateExpression = expr.slice(0, insertAt).replace(/\s*$/, '') + ', ' + clause + expr.slice(insertAt);
    } else {
      params.UpdateExpression = expr ? expr + ' ADD ' + clause : 'ADD ' + clause;
    }
    return params;
  }

  _checkExistence(params, invert) {
    const names = params.ExpressionAttributeNames || {};
    const alias = '#k' + Object.keys(names).length;
    names[alias] = this.keyFields[0].name;
    const condition = `attribute_${invert ? 'not_' : ''}exists(${alias})`;
    params.ExpressionAttributeNames = names;
    params.ConditionExpression = params.ConditionExpression ? `${condition} AND (${params.ConditionExpression})` : condition;
    return params;
  }

  _isIndirect(params, options) {
    if (options?.ignoreIndirection) return false;
    const idx = params?.IndexName;
    return Boolean(idx && this.indices[idx]?.indirect);
  }

  /**
   * Refuse strong-consistent reads against a declared GSI (DynamoDB rejects
   * `ConsistentRead: true` on GSI Query — GSIs are eventually consistent
   * by design). LSIs support strong consistency and are left alone;
   * undeclared indices are deferred to DynamoDB (no local knowledge).
   */
  _checkConsistentRead(params) {
    if (!params?.ConsistentRead) return;
    const idx = params.IndexName;
    if (!idx) return;
    const spec = this.indices[idx];
    if (spec && spec.type === 'gsi') throw new ConsistentReadOnGSIRejected(idx);
  }

  /**
   * Resolve the declared type of a field for `f-filter` value coercion.
   * Walks keyFields → indices (pk then sk). Fields not declared anywhere
   * fall back to `'string'` (DynamoDB's default attribute shape).
   */
  _typeOfField(name) {
    for (const f of this.keyFields) if (f.name === name) return f.type;
    for (const spec of Object.values(this.indices)) {
      if (spec.pk && spec.pk.name === name) return spec.pk.type;
      if (spec.sk && spec.sk.name === name) return spec.sk.type;
    }
    return 'string';
  }

  _coerceFilterValue(name, value) {
    const type = this._typeOfField(name);
    if (type === 'number') {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`f-filter value for '${name}' is not a valid number: '${value}'`);
      return n;
    }
    // 'string' and 'binary' both passed through as-is for now; binary
    // typically arrives already-encoded (base64 string), which DynamoDB's
    // DocumentClient accepts as a Buffer/Uint8Array — callers coerce ahead
    // of time if they need binary filter values.
    return value;
  }

  /**
   * Compile parsed `f-<field>-<op>=<value>` clauses into `params`. Validates
   * each clause against the adapter's `filterable` allowlist; coerces
   * value(s) to the declared field type; auto-promotes index-compatible
   * clauses to `KeyConditionExpression` when the target (base table or
   * `params.IndexName`) has matching pk/sk; everything else lands in
   * `FilterExpression`. Counter-based placeholders live alongside any
   * existing aliases so merging with other builders is safe.
   *
   * @throws `BadFilterField` when a clause names a field not in `filterable`.
   * @throws `BadFilterOp` when the op isn't allowlisted for that field.
   */
  applyFFilter(params, clauses) {
    if (!clauses || clauses.length === 0) return params;
    // Validate allowlist first — fail fast on the whole request.
    for (const c of clauses) {
      const allowed = this.filterable[c.field];
      if (!allowed) throw new BadFilterField(c.field);
      if (!allowed.includes(c.op)) throw new BadFilterOp(c.field, c.op);
    }

    // Determine the target pk/sk for auto-promotion.
    const idxName = params?.IndexName;
    let pkName, skName;
    if (idxName && this.indices[idxName]) {
      const idx = this.indices[idxName];
      pkName = idx.pk ? idx.pk.name : this.keyFields[0].name; // LSI inherits base pk
      skName = idx.sk ? idx.sk.name : undefined;
    } else if (!idxName) {
      pkName = this.keyFields[0].name;
      skName = this.structuralKey ? this.structuralKey.name : undefined;
    }

    const names = params.ExpressionAttributeNames || {};
    const values = params.ExpressionAttributeValues || {};
    let nameCounter = Object.keys(names).length;
    let valueCounter = Object.keys(values).length;
    const allocName = n => {
      const k = '#ff' + nameCounter++;
      names[k] = n;
      return k;
    };
    const allocValue = v => {
      const k = ':ffv' + valueCounter++;
      values[k] = v;
      return k;
    };

    const kcParts = [];
    const feParts = [];

    for (const c of clauses) {
      const canPromote =
        (c.op === 'eq' && pkName && c.field === pkName) ||
        (skName && c.field === skName && (c.op === 'eq' || c.op === 'beg' || c.op === 'btw'));
      const target = canPromote ? kcParts : feParts;
      const nameAlias = allocName(c.field);

      if (F_OP_NO_VALUE.has(c.op)) {
        target.push(c.op === 'ex' ? 'attribute_exists(' + nameAlias + ')' : 'attribute_not_exists(' + nameAlias + ')');
        continue;
      }
      if (c.op === 'in') {
        if (c.values.length === 0) throw new Error(`f-filter 'in' on '${c.field}' requires at least one value`);
        const aliases = c.values.map(v => allocValue(this._coerceFilterValue(c.field, v)));
        target.push(nameAlias + ' IN (' + aliases.join(', ') + ')');
        continue;
      }
      if (c.op === 'btw') {
        if (c.values.length !== 2) throw new Error(`f-filter 'btw' on '${c.field}' requires exactly 2 values`);
        const lo = allocValue(this._coerceFilterValue(c.field, c.values[0]));
        const hi = allocValue(this._coerceFilterValue(c.field, c.values[1]));
        target.push(nameAlias + ' BETWEEN ' + lo + ' AND ' + hi);
        continue;
      }
      if (c.op === 'beg') {
        const v = allocValue(this._coerceFilterValue(c.field, c.values[0]));
        target.push('begins_with(' + nameAlias + ', ' + v + ')');
        continue;
      }
      if (c.op === 'ct') {
        const v = allocValue(this._coerceFilterValue(c.field, c.values[0]));
        target.push('contains(' + nameAlias + ', ' + v + ')');
        continue;
      }
      // Comparison ops: eq ne lt le gt ge.
      const op = F_OP_COMPARISON[c.op];
      const v = allocValue(this._coerceFilterValue(c.field, c.values[0]));
      target.push(nameAlias + ' ' + op + ' ' + v);
    }

    if (kcParts.length) {
      const expr = kcParts.join(' AND ');
      params.KeyConditionExpression = params.KeyConditionExpression
        ? '(' + params.KeyConditionExpression + ') AND (' + expr + ')'
        : expr;
    }
    if (feParts.length) {
      const expr = feParts.join(' AND ');
      params.FilterExpression = params.FilterExpression
        ? '(' + params.FilterExpression + ') AND (' + expr + ')'
        : expr;
    }
    if (Object.keys(names).length) params.ExpressionAttributeNames = names;
    if (Object.keys(values).length) params.ExpressionAttributeValues = values;
    return params;
  }

  /**
   * Find the declared secondary index whose sort key (`sk.name`) matches
   * the requested sort field. Prefers LSI over GSI when both match.
   * Throws `NoIndexForSortField` when no declared index matches — the
   * toolkit does not in-memory-sort (per the no-client-side-list-
   * manipulation principle).
   *
   * @param field Sort field name (from `?sort=<field>` or programmatic
   *   `options.sort`).
   * @returns The name of the matching index.
   * @throws `NoIndexForSortField` when nothing matches.
   */
  findIndexForSort(field) {
    let lsiMatch;
    let gsiMatch;
    for (const name of Object.keys(this.indices)) {
      const spec = this.indices[name];
      if (spec.sk && spec.sk.name === field) {
        if (spec.type === 'lsi') {
          lsiMatch = name;
          break;
        }
        if (!gsiMatch) gsiMatch = name;
      }
    }
    const resolved = lsiMatch ?? gsiMatch;
    if (!resolved) throw new NoIndexForSortField(field);
    return resolved;
  }

  // --- batch builders (return descriptors for use with applyBatch / applyTransaction) ---

  /** @returns {Promise<{action: 'get', adapter: Adapter, params: any}>} */
  async makeGet(key, fields, params) {
    let p = this._cloneParams(params);
    p.Key = this._toKey(key, p.IndexName);
    if (fields) p = addProjection(p, fields, this.projectionFieldMap, true);
    return {action: 'get', adapter: this, params: cleanParams(p)};
  }

  /** @returns {Promise<{action: 'check', params: any}>} */
  async makeCheck(key, params) {
    const p = this._cloneParams(params);
    p.Key = this._toKey(key, p.IndexName);
    return {action: 'check', params: cleanParams(p)};
  }

  /** @returns {Promise<{action: 'put', params: any}>} */
  async makePost(item, options) {
    await this._validate(item);
    // Post is first-write. If versionField is declared, bump sets it
    // to 1 (observed is undefined, no condition on version needed —
    // attribute_not_exists already covers the race where another
    // writer got there first).
    const {item: versioned} = this._applyVersionToItem(item);
    let p = {TableName: this.table, Item: this._prepareItem(versioned)};
    p = this._checkExistence(p, true);
    if (options?.returnFailedItem) p.ReturnValuesOnConditionCheckFailure = 'ALL_OLD';
    p = this.hooks.updateInput(p, {name: 'post'});
    return {action: 'put', params: cleanParams(p)};
  }

  /** @returns {Promise<{action: 'put', params: any}>} */
  async makePut(item, options) {
    const force = options?.force;
    await this._validate(item);
    let p = this._cloneParams(options?.params);
    const {item: versioned, observed} = this._applyVersionToItem(item);
    p.Item = this._prepareItem(versioned);

    if (!force) {
      if (this.versionField) {
        // OC condition replaces `attribute_exists` — the OR branch
        // handles the first-write case that plain attribute_exists
        // would refuse.
        p = this._addVersionCondition(p, observed);
      } else {
        p = this._checkExistence(p);
      }
    }

    if (options?.conditions) p = buildCondition(options.conditions, p);
    if (options?.returnFailedItem) p.ReturnValuesOnConditionCheckFailure = 'ALL_OLD';
    p = this.hooks.updateInput(p, {name: 'put', force});
    return {action: 'put', params: cleanParams(p)};
  }

  /** @returns {Promise<{action: 'patch', params: any}>} */
  async makePatch(key, patch, options) {
    let payload;
    if (patch instanceof Raw) {
      payload = {...patch.item};
    } else {
      await this._validate(patch, true);
      payload = {...this.hooks.prepare(patch, true)};
    }
    for (const field of this.keyFields) delete payload[field.name];
    // User is not allowed to set the version field directly — it's
    // toolkit-managed. Strip silently; the ADD clause below handles
    // the real increment.
    if (this.versionField) delete payload[this.versionField];

    let p = this._cloneParams(options?.params);
    p.Key = this._toKey(key, p.IndexName);
    // Patch always requires the item to exist — applying an
    // UpdateExpression to an absent key would silently upsert, which is
    // not what `patch` means. Version condition is additive only when
    // the caller supplied `expectedVersion`; without it we condition on
    // existence but not on version (the version still ADDs +1 via
    // `_addVersionIncrement` below).
    if (this.versionField && options?.expectedVersion !== undefined) {
      p = this._addVersionCondition(p, options.expectedVersion);
    } else {
      p = this._checkExistence(p);
    }
    if (options?.conditions) p = buildCondition(options.conditions, p);
    p = buildUpdate(payload, {delete: options?.delete, separator: options?.separator, arrayOps: options?.arrayOps}, p);
    // Auto-increment the version via an ADD clause on the UpdateExpression.
    // ADD is atomic on the server; also correctly initialises the attribute
    // from absent → 1 (DynamoDB treats missing numeric counters as 0 for ADD).
    if (this.versionField) {
      p = this._addVersionIncrement(p);
    }
    if (options?.returnFailedItem) p.ReturnValuesOnConditionCheckFailure = 'ALL_OLD';
    p = this.hooks.updateInput(p, {name: 'patch'});
    return {action: 'patch', params: cleanParams(p)};
  }

  /** @returns {Promise<{action: 'delete', params: any}>} */
  async makeDelete(key, options) {
    let p = this._cloneParams(options?.params);
    p.Key = this._toKey(key, p.IndexName);
    // Delete conditions on the version only when the caller supplied
    // `expectedVersion`. Plain delete (no OC) remains unconditional —
    // deletes are idempotent on absent items anyway. No increment.
    if (this.versionField && options?.expectedVersion !== undefined) {
      const names = p.ExpressionAttributeNames || {};
      const values = p.ExpressionAttributeValues || {};
      const vfAlias = '#vf' + Object.keys(names).length;
      names[vfAlias] = this.versionField;
      const vAlias = ':vfv' + Object.keys(values).length;
      values[vAlias] = Number(options.expectedVersion);
      p.ExpressionAttributeNames = names;
      p.ExpressionAttributeValues = values;
      const condition = `${vfAlias} = ${vAlias}`;
      p.ConditionExpression = p.ConditionExpression ? `(${condition}) AND (${p.ConditionExpression})` : condition;
    }
    if (options?.conditions) p = buildCondition(options.conditions, p);
    if (options?.returnFailedItem) p.ReturnValuesOnConditionCheckFailure = 'ALL_OLD';
    p = this.hooks.updateInput(p, {name: 'delete'});
    return {action: 'delete', params: cleanParams(p)};
  }

  // --- single ops with auto-upgrade ---

  async post(item, options) {
    const batch = await this.makePost(item, options);
    const checks = await this.hooks.checkConsistency(batch);
    return dispatchWrite(this.client, batch, checks);
  }

  async put(item, options) {
    const batch = await this.makePut(item, options);
    const checks = await this.hooks.checkConsistency(batch);
    return dispatchWrite(this.client, batch, checks);
  }

  async patch(key, patch, options) {
    const batch = await this.makePatch(key, patch, options);
    const checks = await this.hooks.checkConsistency(batch);
    return dispatchWrite(this.client, batch, checks);
  }

  // Compute the edit diff from a raw DB item + mapFn. Returns a tagged
  // descriptor so callers (single-item `edit` vs mass `editListByParams`)
  // can decide what to do for each outcome: throw vs bucket, auto-move
  // vs fail. No I/O — pure transform.
  _diffForUpdate(rawItem, mapFn) {
    const revived = this.hooks.revive(rawItem);
    const mapped = mapFn(revived);
    if (!mapped) return {status: 'mapfn-dropped'};
    const prepared = this._prepareItem(mapped);

    /** @type {Record<string, unknown>} */
    const setOps = {};
    /** @type {string[]} */
    const removeOps = [];
    const allFields = new Set([...Object.keys(rawItem), ...Object.keys(prepared)]);
    for (const field of allFields) {
      const before = rawItem[field];
      const after = prepared[field];
      if (after === undefined) {
        if (before !== undefined) removeOps.push(field);
      } else if (!deepEqual(before, after)) {
        setOps[field] = after;
      }
    }

    const changedKeyFields = this.keyFields.map(f => f.name).filter(n => n in setOps || removeOps.includes(n));
    if (changedKeyFields.length) return {status: 'keyfield-changed', changedKeyFields, mapped, revived};
    if (!Object.keys(setOps).length && !removeOps.length) return {status: 'noop', revived};
    return {status: 'update', setOps, removeOps, mapped, prepared, revived};
  }

  // Build + send the UpdateCommand from a diff descriptor. Caller
  // supplies the Dynamo-shaped Key (already run through `_toKey` or
  // `_restrictKey`), so this helper doesn't re-derive it.
  async _dispatchEdit(dynamoKey, setOps, removeOps, observedVersion, options) {
    let p = this._cloneParams(options?.params);
    p.Key = dynamoKey;

    // The diff may include the versionField if the user's mapFn
    // passed the raw item through a spread. Strip it — the toolkit
    // owns the increment via the ADD clause below.
    if (this.versionField) {
      delete setOps[this.versionField];
      const idx = removeOps.indexOf(this.versionField);
      if (idx !== -1) removeOps.splice(idx, 1);
    }

    if (this.versionField) {
      p = this._addVersionCondition(p, observedVersion);
    } else {
      p = this._checkExistence(p);
    }
    p = buildUpdate(setOps, {delete: removeOps}, p);
    if (this.versionField) {
      p = this._addVersionIncrement(p);
    }
    if (options?.returnFailedItem) p.ReturnValuesOnConditionCheckFailure = 'ALL_OLD';
    p = this.hooks.updateInput(p, {name: 'edit'});
    /** @type {{action: 'patch', params: any}} */
    const batch = {action: 'patch', params: cleanParams(p)};
    const checks = await this.hooks.checkConsistency(batch);
    await dispatchWrite(this.client, batch, checks);
  }

  async edit(key, mapFn, options) {
    // Fetch the raw DB item so we can diff against the actual stored shape
    // (technical fields included). `readFields` limits the GetItem
    // projection — callers who know only a subset of fields matter for the
    // diff can save RCU. When projected, the diff is restricted to those
    // fields plus whatever `prepare` touches (structural key, searchable
    // mirrors) — the toolkit re-adds them, so they are never missed.
    const rawResult = await this.getByKey(key, options?.readFields, {...options, reviveItems: false});
    if (rawResult === undefined) return undefined;
    const rawItem = rawResult instanceof Raw ? rawResult.item : rawResult;

    const diff = this._diffForUpdate(rawItem, mapFn);

    if (diff.status === 'mapfn-dropped') return undefined;
    if (diff.status === 'noop') return diff.revived;

    if (diff.status === 'keyfield-changed') {
      if (!options?.allowKeyChange) throw new KeyFieldChanged(diff.changedKeyFields);
      await this.move(key, () => diff.mapped, options);
      return diff.mapped;
    }

    // status === 'update'
    const observedVersion = this.versionField ? rawItem[this.versionField] : undefined;
    const observed = observedVersion === undefined || observedVersion === null ? undefined : Number(observedVersion);
    await this._dispatchEdit(this._toKey(key), diff.setOps, diff.removeOps, observed, options);
    // Reflect the incremented version in the returned revived item so
    // the caller can immediately use it for a follow-up write.
    if (this.versionField) {
      diff.prepared[this.versionField] = (observed || 0) + 1;
    }
    return this.hooks.revive(diff.prepared);
  }

  async editListByParams(params, mapFn, options) {
    let p = this._cloneParams(params);
    p = this._applyAsOf(p, options?.asOf);
    p = cleanParams(p);

    return runPaged(this.client, p, options, async items => {
      let processed = 0;
      let skipped = 0;
      /** @type {import('../mass/index.js').MassOpFailure[]} */
      const failed = [];
      /** @type {import('../mass/index.js').MassOpConflict[]} */
      const conflicts = [];

      for (const rawItem of items) {
        const key = this._restrictKey(rawItem);
        const diff = this._diffForUpdate(rawItem, mapFn);

        if (diff.status === 'mapfn-dropped' || diff.status === 'noop') {
          skipped++;
          continue;
        }

        if (diff.status === 'keyfield-changed') {
          if (!options?.allowKeyChange) {
            failed.push({
              key,
              reason: 'Unknown',
              details: `editListByParams: key field(s) changed [${diff.changedKeyFields.join(', ')}]; pass {allowKeyChange: true} to auto-promote to move`
            });
            continue;
          }
          try {
            await this.move(key, () => diff.mapped, options);
            processed++;
          } catch (err) {
            failed.push({key, reason: classifyMassOpError(err), details: err?.message, sdkError: err});
          }
          continue;
        }

        // status === 'update'
        const observedV = this.versionField ? rawItem[this.versionField] : undefined;
        const observed = observedV === undefined || observedV === null ? undefined : Number(observedV);
        try {
          await this._dispatchEdit(key, diff.setOps, diff.removeOps, observed, options);
          processed++;
        } catch (err) {
          // CCF in the versioned path means: either the item was
          // deleted (race) or the version changed (conflict). We can't
          // distinguish without another read — bucket into `conflicts`
          // when versionField is declared (the far more common cause),
          // otherwise `skipped` as before.
          if (isConditionFailure(err)) {
            if (this.versionField) {
              conflicts.push({key, reason: 'VersionConflict', sdkError: err});
              continue;
            }
            skipped++;
            continue;
          }
          failed.push({key, reason: classifyMassOpError(err), details: err?.message, sdkError: err});
        }
      }

      return {processed, skipped, failed, conflicts};
    });
  }

  // --- subtree macros: rename / cloneWithOverwrite ---
  //
  // Scope macros for hierarchical keys. Both query the `fromExample`
  // subtree via `buildKey({kind: 'children'})` by default (override with
  // `options.kind: 'exact'` for leaf operations), run each item through
  // `swapPrefix(fromExample, toExample)` to derive the destination, and
  // apply an idempotent two-phase write so resumes don't corrupt state.
  //
  // rename:             put-if-not-exists (dst) → delete (src)
  //                     constructive before destructive; re-runs are
  //                     safe because ifNotExists rejects the put on a
  //                     completed item, and the delete is idempotent.
  //
  // cloneWithOverwrite: delete (dst) → put (dst)
  //                     destructive before constructive; source stays.
  //                     re-runs are safe because re-deleting an absent
  //                     destination is a CCF we ignore, and the put
  //                     just rewrites on retry.
  //
  // Non-transactional. If caller needs atomicity on a single item, use
  // `move` (TransactWriteCommand).

  async rename(fromExample, toExample, options) {
    let queryParams = this.buildKey(fromExample, {kind: options?.kind || 'children'});
    queryParams.TableName = this.table;
    queryParams = this._applyAsOf(queryParams, options?.asOf);

    const keyShifter = this.swapPrefix(fromExample, toExample);
    const mapFn = options?.mapFn ? mergeMapFn(keyShifter, options.mapFn) : keyShifter;

    return this._subtreeRename(queryParams, mapFn, options);
  }

  async cloneWithOverwrite(fromExample, toExample, options) {
    let queryParams = this.buildKey(fromExample, {kind: options?.kind || 'children'});
    queryParams.TableName = this.table;
    queryParams = this._applyAsOf(queryParams, options?.asOf);

    const keyShifter = this.swapPrefix(fromExample, toExample);
    const mapFn = options?.mapFn ? mergeMapFn(keyShifter, options.mapFn) : keyShifter;

    return runPaged(this.client, queryParams, options, async items => {
      let processed = 0;
      let skipped = 0;
      /** @type {import('../mass/index.js').MassOpFailure[]} */
      const failed = [];

      for (const rawItem of items) {
        const srcKey = this._restrictKey(rawItem);
        const revived = this.hooks.revive(rawItem);
        const mapped = mapFn(revived);
        if (!mapped) {
          skipped++;
          continue;
        }
        const prepared = this._prepareItem(mapped);
        const dstKey = this._restrictKey(prepared);

        // Phase 1: delete dst. Idempotent via CCF-ignore on absent
        // destination. Unconditional delete (no ifExists) — the goal
        // is "destination is empty after this phase," which an absent
        // destination already satisfies.
        try {
          await this.client.send(new DeleteCommand({TableName: this.table, Key: dstKey}));
        } catch (err) {
          if (!isConditionFailure(err)) {
            failed.push({key: srcKey, reason: classifyMassOpError(err), details: err?.message, sdkError: err});
            continue;
          }
        }

        // Phase 2: put to dst unconditionally. The delete in phase 1
        // cleared any pre-existing destination; this put writes the
        // new content. Source stays intact (clone, not move).
        try {
          await this.client.send(new PutCommand({TableName: this.table, Item: prepared}));
          processed++;
        } catch (err) {
          failed.push({key: srcKey, reason: classifyMassOpError(err), details: err?.message, sdkError: err});
        }
      }

      return {processed, skipped, failed};
    });
  }

  // --- cascade primitives (A6' — 3.5.0) ---
  //
  // Subtree operations rooted at a partial `srcKey`. "Under" means self +
  // strict descendants (the key itself plus everything declared to hang
  // off it via the structural key). Require an explicit `relationships`
  // declaration — the toolkit will not infer cascade scope from composite
  // `keyFields` alone.
  //
  // Two method families per op (deliberately separate, no overload):
  //   - `...AllUnder(srcKey, dstKey, options)` — uniform prefix-swap to
  //     a single destination subtree. `options.mapFn` composes after the
  //     swap (same pattern as `rename`/`cloneWithOverwrite`).
  //   - `...AllUnderBy(srcKey, mapFn, options)` — caller-supplied mapFn
  //     drives destinations. Useful for fan-out (e.g., clone Austin
  //     records to different cities based on a property).

  _requireStructuralCascade(op) {
    if (!this.relationships?.structural) {
      throw new CascadeNotDeclared(op);
    }
  }

  _mergeMassOpResults(a, b) {
    return {
      processed: (a.processed ?? 0) + (b.processed ?? 0),
      skipped: (a.skipped ?? 0) + (b.skipped ?? 0),
      failed: [...(a.failed ?? []), ...(b.failed ?? [])],
      conflicts: [...(a.conflicts ?? []), ...(b.conflicts ?? [])]
    };
  }

  async _getRawSelf(srcKey) {
    const dbKey = this._toKey(srcKey);
    const data = await this.client.send(new GetCommand({TableName: this.table, Key: dbKey}));
    return data.Item;
  }

  async _cascadeSelfDelete(srcKey) {
    const dbKey = this._toKey(srcKey);
    // ifExists: distinguish "deleted the self node" from "self was absent"
    // in the return shape (processed vs skipped).
    const params = this._checkExistence({TableName: this.table, Key: dbKey}, false);
    try {
      await this.client.send(new DeleteCommand(params));
      return {processed: 1, skipped: 0, failed: [], conflicts: []};
    } catch (err) {
      if (isConditionFailure(err)) return {processed: 0, skipped: 1, failed: [], conflicts: []};
      return {
        processed: 0,
        skipped: 0,
        failed: [{key: dbKey, reason: classifyMassOpError(err), details: err?.message, sdkError: err}],
        conflicts: []
      };
    }
  }

  async _cascadeSelfClone(srcKey, mapFn, options) {
    const rawItem = await this._getRawSelf(srcKey);
    if (!rawItem) return {processed: 0, skipped: 0, failed: [], conflicts: []};

    const revived = this.hooks.revive(rawItem);
    const mapped = mapFn(revived);
    if (!mapped) return {processed: 0, skipped: 1, failed: [], conflicts: []};

    const prepared = this._prepareItem(mapped);

    if (options?.ifNotExists || options?.ifExists) {
      const result = await this._putWithCondition([prepared], options);
      return {
        processed: result.processed,
        skipped: result.skipped,
        failed: result.failed,
        conflicts: []
      };
    }

    try {
      await this.client.send(new PutCommand({TableName: this.table, Item: prepared}));
      return {processed: 1, skipped: 0, failed: [], conflicts: []};
    } catch (err) {
      return {
        processed: 0,
        skipped: 0,
        failed: [{key: this._restrictKey(prepared), reason: classifyMassOpError(err), details: err?.message, sdkError: err}],
        conflicts: []
      };
    }
  }

  async _cascadeSelfMove(srcKey, mapFn) {
    const rawItem = await this._getRawSelf(srcKey);
    if (!rawItem) return {processed: 0, skipped: 0, failed: [], conflicts: []};

    const revived = this.hooks.revive(rawItem);
    const mapped = mapFn(revived);
    if (!mapped) return {processed: 0, skipped: 1, failed: [], conflicts: []};

    const prepared = this._prepareItem(mapped);
    const srcDbKey = this._restrictKey(rawItem);

    // Phase 1: put dst ifNotExists (rename's constructive-before-destructive).
    try {
      const putParams = this._checkExistence({TableName: this.table, Item: prepared}, true);
      await this.client.send(new PutCommand(putParams));
    } catch (err) {
      if (isConditionFailure(err)) return {processed: 0, skipped: 1, failed: [], conflicts: []};
      return {
        processed: 0,
        skipped: 0,
        failed: [{key: srcDbKey, reason: classifyMassOpError(err), details: err?.message, sdkError: err}],
        conflicts: []
      };
    }

    // Phase 2: delete src. Partial failure leaves a duplicate — bucket as
    // failed so the caller knows to clean up.
    try {
      await this.client.send(new DeleteCommand({TableName: this.table, Key: srcDbKey}));
      return {processed: 1, skipped: 0, failed: [], conflicts: []};
    } catch (err) {
      return {
        processed: 0,
        skipped: 0,
        failed: [{key: srcDbKey, reason: classifyMassOpError(err), details: err?.message, sdkError: err}],
        conflicts: []
      };
    }
  }

  async deleteAllUnder(srcKey, options) {
    this._requireStructuralCascade('deleteAllUnder');
    // Leaf-first: delete descendants before self. Self-delete deferred
    // until pagination of descendants completes.
    const queryParams = this.buildKey(srcKey, {kind: 'children'});
    queryParams.TableName = this.table;
    const childrenResult = await this.deleteListByParams(queryParams, options);
    if (childrenResult.cursor) return childrenResult;
    const selfResult = await this._cascadeSelfDelete(srcKey);
    return this._mergeMassOpResults(childrenResult, selfResult);
  }

  // cloneAllUnder(srcKey, dstKey, options): uniform prefix-swap subtree
  // clone. `options.mapFn` composes after the swapPrefix shift, same as
  // `rename` / `cloneWithOverwrite`. Root-first; source stays intact.
  async cloneAllUnder(srcKey, dstKey, options) {
    this._requireStructuralCascade('cloneAllUnder');
    const keyShifter = this.swapPrefix(srcKey, dstKey);
    const mapFn = options?.mapFn ? mergeMapFn(keyShifter, options.mapFn) : keyShifter;
    return this._cascadeCloneCore(srcKey, mapFn, options);
  }

  // cloneAllUnderBy(srcKey, mapFn, options): mapFn-driven subtree clone —
  // destinations are whatever mapFn computes per item. Useful for fan-out
  // (e.g., route Austin records to CA / FL based on a property). Source
  // stays intact; same root-first / skip-on-mapFn-falsy semantics.
  async cloneAllUnderBy(srcKey, mapFn, options) {
    this._requireStructuralCascade('cloneAllUnderBy');
    return this._cascadeCloneCore(srcKey, mapFn, options);
  }

  async _cascadeCloneCore(srcKey, mapFn, options) {
    // Root-first: self before descendants. Self-clone runs only on the
    // first page (no resumeToken) so resuming doesn't re-process it.
    let selfResult;
    if (!options?.resumeToken) {
      selfResult = await this._cascadeSelfClone(srcKey, mapFn, options);
    }

    const queryParams = this.buildKey(srcKey, {kind: 'children'});
    queryParams.TableName = this.table;
    const childrenResult = await this.cloneListByParams(queryParams, mapFn, options);

    return selfResult ? this._mergeMassOpResults(selfResult, childrenResult) : childrenResult;
  }

  // moveAllUnder(srcKey, dstKey, options): uniform prefix-swap subtree
  // move. `options.mapFn` composes after the swapPrefix shift. Leaf-first
  // — descendants migrate before the self node.
  async moveAllUnder(srcKey, dstKey, options) {
    this._requireStructuralCascade('moveAllUnder');
    const keyShifter = this.swapPrefix(srcKey, dstKey);
    const mapFn = options?.mapFn ? mergeMapFn(keyShifter, options.mapFn) : keyShifter;
    return this._cascadeMoveCore(srcKey, mapFn, options);
  }

  // moveAllUnderBy(srcKey, mapFn, options): mapFn-driven subtree move.
  // Destinations per item as mapFn dictates. Same leaf-first semantics;
  // source items removed after their copy lands at the mapFn-computed
  // destination.
  async moveAllUnderBy(srcKey, mapFn, options) {
    this._requireStructuralCascade('moveAllUnderBy');
    return this._cascadeMoveCore(srcKey, mapFn, options);
  }

  async _cascadeMoveCore(srcKey, mapFn, options) {
    // Leaf-first for the delete phase: process descendants first, then
    // self. Per-item copy+delete is interleaved inside `_subtreeRename`,
    // so children migrate fully before self.
    let queryParams = this.buildKey(srcKey, {kind: 'children'});
    queryParams.TableName = this.table;
    queryParams = this._applyAsOf(queryParams, options?.asOf);
    const childrenResult = await this._subtreeRename(queryParams, mapFn, options);
    if (childrenResult.cursor) return childrenResult;

    const selfResult = await this._cascadeSelfMove(srcKey, mapFn);
    return this._mergeMassOpResults(childrenResult, selfResult);
  }

  // Shared scan-rename loop used by `rename` and `moveAllUnder`. Emits
  // the two-phase idempotent put-ifNotExists → delete-src pattern per
  // item. See the rename docstring above for semantics.
  _subtreeRename(queryParams, mapFn, options) {
    return runPaged(this.client, queryParams, options, async items => {
      let processed = 0;
      let skipped = 0;
      /** @type {import('../mass/index.js').MassOpFailure[]} */
      const failed = [];

      for (const rawItem of items) {
        const srcKey = this._restrictKey(rawItem);
        const revived = this.hooks.revive(rawItem);
        const mapped = mapFn(revived);
        if (!mapped) {
          skipped++;
          continue;
        }
        const prepared = this._prepareItem(mapped);

        try {
          const putParams = this._checkExistence({TableName: this.table, Item: prepared}, true);
          await this.client.send(new PutCommand(putParams));
        } catch (err) {
          if (isConditionFailure(err)) {
            skipped++;
            continue;
          }
          failed.push({key: srcKey, reason: classifyMassOpError(err), details: err?.message, sdkError: err});
          continue;
        }

        try {
          await this.client.send(new DeleteCommand({TableName: this.table, Key: srcKey}));
          processed++;
        } catch (err) {
          failed.push({key: srcKey, reason: classifyMassOpError(err), details: err?.message, sdkError: err});
        }
      }

      return {processed, skipped, failed};
    });
  }

  async delete(key, options) {
    const batch = await this.makeDelete(key, options);
    const checks = await this.hooks.checkConsistency(batch);
    return dispatchWrite(this.client, batch, checks);
  }

  // --- reads ---

  async getByKey(key, fields, options) {
    const params = options?.params;
    const isIndirect = this._isIndirect(params, options);
    const activeFields = isIndirect ? this.primaryKeyAttrs : fields;
    const batch = await this.makeGet(key, activeFields, params);

    let data = await this.client.send(new GetCommand(batch.params));
    if (!data.Item) return undefined;

    if (isIndirect) {
      const indirectParams = params ? cloneParams(params) : {};
      delete indirectParams.IndexName;
      const indirectBatch = await this.makeGet(new Raw(this._restrictKey(data.Item)), fields, indirectParams);
      data = await this.client.send(new GetCommand(indirectBatch.params));
      if (!data.Item) return undefined;
    }

    return this._reviveOne(data.Item, fields, options);
  }

  async getByKeys(keys, fields, options) {
    const params = options?.params;
    const isIndirect = this._isIndirect(params, options);
    const activeFields = isIndirect ? this.primaryKeyAttrs : fields;

    let activeParams = this._cloneParams(params);
    if (activeFields) activeParams = addProjection(activeParams, activeFields, this.projectionFieldMap, true);
    activeParams = cleanParams(activeParams);
    const dynamoKeys = keys.map(k => this._toKey(k, activeParams.IndexName));

    let items = await readByKeys(this.client, this.table, dynamoKeys, activeParams);

    if (isIndirect && items.some(Boolean)) {
      let indirectParams = this._cloneParams(params);
      delete indirectParams.IndexName;
      if (fields) indirectParams = addProjection(indirectParams, fields, this.projectionFieldMap, true);
      indirectParams = cleanParams(indirectParams);
      // Second-hop BatchGet against the base table. Only the items that the
      // first-hop GSI Query found have keys to chase; misses stay misses and
      // the position alignment with the caller's original `keys` is preserved.
      const foundIndexes = [];
      const foundKeys = [];
      items.forEach((item, i) => {
        if (item) {
          foundIndexes.push(i);
          foundKeys.push(this._restrictKey(item));
        }
      });
      const fetched = await readByKeys(this.client, this.table, foundKeys, indirectParams);
      const remapped = new Array(items.length).fill(undefined);
      foundIndexes.forEach((i, j) => (remapped[i] = fetched[j]));
      items = remapped;
    }

    // Length-preserving: `result[i]` corresponds to `keys[i]` — `undefined` at
    // missing positions (per the bulk-individual-read contract). Callers who
    // want a compact array call `.filter(Boolean)` themselves.
    return items.map(item => (item ? this._reviveOne(item, fields, options) : undefined));
  }

  async getList(options, example, index) {
    const params = await this._buildListParams(options, true, example, index);
    return this.getListByParams(params, options);
  }

  async getListByParams(params, options) {
    this._checkConsistentRead(params);
    const isIndirect = this._isIndirect(params, options);
    let activeParams = this._cloneParams(params);
    if (isIndirect) {
      delete activeParams.ProjectionExpression;
      activeParams = addProjection(activeParams, this.primaryKeyAttrs, null, true);
    }
    // Honor options.fFilter / options.filter / options.asOf the same
    // way the mass-op list methods (`deleteListByParams` etc.) do —
    // otherwise passing these through a hand-built-params path would
    // silently ignore them. Both entry points (getList via
    // `_buildListParams`, and getListByParams via hand-built params)
    // funnel through here.
    if (options?.fFilter && options.fFilter.length) {
      activeParams = this.applyFFilter(activeParams, options.fFilter);
    }
    if (options?.filter) {
      activeParams = buildFilter(
        this.searchable,
        options.filter,
        {fields: options.fields, prefix: this.searchablePrefix, caseSensitive: options.caseSensitive},
        activeParams
      );
    }
    activeParams = this._applyAsOf(activeParams, options?.asOf);
    activeParams = cleanParams(activeParams);

    const needTotal = options?.needTotal !== false;
    const result = await paginateList(this.client, activeParams, options, needTotal);

    if (isIndirect && result.data.length) {
      let indirectParams = this._cloneParams(params);
      delete indirectParams.IndexName;
      if (options?.fields) indirectParams = addProjection(indirectParams, options.fields, this.projectionFieldMap, true);
      indirectParams = cleanParams(indirectParams);
      const items = await readByKeys(
        this.client,
        this.table,
        result.data.map(item => this._restrictKey(item)),
        indirectParams
      );
      result.data = items.filter(Boolean);
    }

    result.data = result.data.map(item => this._reviveOne(item, options?.fields, options));
    return result;
  }

  // --- mass writes ---

  async putItems(items, options) {
    const strategy = options?.strategy || 'native';
    if (strategy === 'sequential') {
      let processed = 0;
      for (const item of items) {
        await this.put(item, {force: true, params: options?.params});
        processed++;
      }
      return {processed};
    }
    const processed = await writeItems(this.client, this.table, items, item => this._prepareItem(item));
    return {processed};
  }

  async deleteByKeys(keys, options) {
    const strategy = options?.strategy || 'native';
    if (strategy === 'sequential') {
      let processed = 0;
      for (const key of keys) {
        await this.delete(key);
        processed++;
      }
      return {processed};
    }
    const dynamoKeys = keys.map(k => this._toKey(k));
    const processed = await deleteByKeys(this.client, this.table, dynamoKeys);
    return {processed};
  }

  async deleteListByParams(params, options) {
    let p = this._cloneParams(params);
    p = addProjection(p, this.primaryKeyAttrs.join(','), null, true);
    p = this._applyAsOf(p, options?.asOf);
    p = cleanParams(p);

    return runPaged(this.client, p, options, async items => {
      const keys = items.map(item => this._restrictKey(item)).filter(Boolean);
      if (!keys.length) return {processed: 0};
      /** @type {{action: 'delete', params: any}[]} */
      const batch = keys.map(key => ({action: 'delete', params: {TableName: this.table, Key: key}}));
      const processed = await applyBatch(this.client, batch);
      return {processed};
    });
  }

  async cloneByKeys(keys, mapFn, options) {
    const dynamoKeys = keys.map(k => this._toKey(k));
    const items = await readByKeys(this.client, this.table, dynamoKeys);
    const cloned = items.filter(Boolean).map(item => {
      const revived = this.hooks.revive(item);
      const mapped = mapFn(revived);
      return mapped ? this._prepareItem(mapped) : null;
    });
    const valid = cloned.filter(Boolean);
    if (!valid.length) return {processed: 0};

    // Conditions → per-item PutItem + ConditionExpression. BatchWriteItem
    // doesn't support conditions, so the caller trades batching for
    // "don't overwrite" / "only update existing" semantics.
    if (options?.ifNotExists || options?.ifExists) {
      const result = await this._putWithCondition(valid, options);
      return {processed: result.processed, skipped: result.skipped, failed: result.failed, conflicts: []};
    }

    const processed = await writeItems(this.client, this.table, valid);
    return {processed};
  }

  async cloneListByParams(params, mapFn, options) {
    let p = this._cloneParams(params);
    p = this._applyAsOf(p, options?.asOf);
    p = cleanParams(p);

    const useConditionPath = options?.ifNotExists || options?.ifExists;

    return runPaged(this.client, p, options, async items => {
      const prepared = items
        .map(item => {
          const revived = this.hooks.revive(item);
          const mapped = mapFn(revived);
          return mapped ? this._prepareItem(mapped) : null;
        })
        .filter(Boolean);
      if (!prepared.length) return {processed: 0};

      if (useConditionPath) {
        return this._putWithCondition(prepared, options);
      }

      /** @type {{action: 'put', params: any}[]} */
      const batch = prepared.map(item => ({action: 'put', params: {TableName: this.table, Item: item}}));
      const processed = await applyBatch(this.client, batch);
      return {processed};
    });
  }

  // Per-item PutItem with ConditionExpression. Used by clone when
  // ifNotExists / ifExists is set. ConditionalCheckFailed is bucketed
  // into `skipped` (expected outcome of the caller's semantic — "only
  // if absent" or "only if present"); other SDK errors are bucketed
  // into `failed` with `reason: 'ConditionalCheckFailed'` remapped to
  // the underlying AWS reason. Throws on errors unrelated to a single
  // item (network, auth) so callers don't silently continue.
  async _putWithCondition(items, options) {
    const invert = Boolean(options?.ifNotExists); // _checkExistence(p, true) → attribute_not_exists
    let processed = 0;
    let skipped = 0;
    /** @type {import('../mass/index.js').MassOpFailure[]} */
    const failed = [];
    for (const item of items) {
      const p = {TableName: this.table, Item: item};
      const withCondition = this._checkExistence(p, invert);
      try {
        await this.client.send(new PutCommand(withCondition));
        processed++;
      } catch (err) {
        if (isConditionFailure(err)) {
          skipped++;
          continue;
        }
        // Non-CCF errors that are clearly per-item (ValidationException,
        // ProvisionedThroughputExceeded) get bucketed; other errors
        // (network, auth) re-throw so the caller sees them.
        const reason = err?.name;
        if (reason === 'ValidationException' || reason === 'ProvisionedThroughputExceededException') {
          failed.push({key: this._restrictKey(item), reason, details: err?.message, sdkError: err});
          continue;
        }
        throw err;
      }
    }
    return {processed, skipped, failed};
  }

  async moveByKeys(keys, mapFn, _options) {
    const dynamoKeys = keys.map(k => this._toKey(k));
    const items = await readByKeys(this.client, this.table, dynamoKeys);
    const valid = items.filter(Boolean);
    if (!valid.length) return {processed: 0};

    let processed = 0;
    for (let i = 0; i < valid.length; i += MOVE_CHUNK) {
      const slice = valid.slice(i, i + MOVE_CHUNK);
      // Pair put + delete per item so a falsy mapFn result drops BOTH legs —
      // otherwise the source is deleted without the transformed copy being written.
      const pairs = [];
      for (const item of slice) {
        const revived = this.hooks.revive(item);
        const mapped = mapFn(revived);
        if (!mapped) continue;
        pairs.push({put: this._prepareItem(mapped), key: this._restrictKey(item)});
      }
      if (!pairs.length) continue;
      /** @type {{action: 'put', params: any}[]} */
      const puts = pairs.map(({put}) => ({action: 'put', params: {TableName: this.table, Item: put}}));
      /** @type {{action: 'delete', params: any}[]} */
      const deletes = pairs.map(({key}) => ({action: 'delete', params: {TableName: this.table, Key: key}}));
      processed += await applyBatch(this.client, [...puts, ...deletes]);
    }
    return {processed};
  }

  async moveListByParams(params, mapFn, options) {
    let p = this._cloneParams(params);
    p = this._applyAsOf(p, options?.asOf);
    p = cleanParams(p);

    return runPaged(this.client, p, options, async items => {
      let processed = 0;
      for (let offset = 0; offset < items.length; offset += MOVE_CHUNK) {
        const slice = items.slice(offset, offset + MOVE_CHUNK);
        // Pair put + delete per item so a falsy mapFn drops BOTH legs —
        // otherwise the source gets deleted without its transformed copy being written.
        const pairs = [];
        for (const item of slice) {
          const revived = this.hooks.revive(item);
          const mapped = mapFn(revived);
          if (!mapped) continue;
          pairs.push({put: this._prepareItem(mapped), key: this._restrictKey(item)});
        }
        if (!pairs.length) continue;
        /** @type {{action: 'put', params: any}[]} */
        const puts = pairs.map(({put}) => ({action: 'put', params: {TableName: this.table, Item: put}}));
        /** @type {{action: 'delete', params: any}[]} */
        const deletes = pairs.map(({key}) => ({action: 'delete', params: {TableName: this.table, Key: key}}));
        processed += await applyBatch(this.client, [...puts, ...deletes]);
      }
      return {processed};
    });
  }

  // --- single clone / move ---

  async clone(key, mapFn, options) {
    const item = await this.getByKey(key, undefined, {...options, reviveItems: true});
    if (item === undefined) return undefined;
    const cloned = mapFn ? mapFn(item) : item;
    if (options?.force) {
      await this.put(cloned, {force: true, params: options?.params});
    } else {
      await this.post(cloned);
    }
    return cloned;
  }

  async move(key, mapFn, options) {
    const item = await this.getByKey(key, undefined, {...options, reviveItems: true});
    if (item === undefined) return undefined;
    const cloned = mapFn ? mapFn(item) : item;

    const writeBatch = options?.force
      ? await this.makePut(cloned, {force: true, params: options?.params})
      : await this.makePost(cloned);
    const writeChecks = await this.hooks.checkConsistency(writeBatch);
    const deleteBatch = await this.makeDelete(key, {params: options?.params});
    const deleteChecks = await this.hooks.checkConsistency(deleteBatch);

    await applyTransaction(this.client, writeChecks, writeBatch, deleteChecks, deleteBatch);
    return cloned;
  }

  // --- list params helper ---

  async _buildListParams(options, project, example, index) {
    // Resolve the effective index. Precedence:
    //   1. Explicit `index` argument (from REST handler or caller).
    //   2. `options.useIndex` override.
    //   3. `options.sort` → `findIndexForSort` (throws on no match).
    let resolvedIndex = index;
    if (resolvedIndex === undefined) {
      if (options?.useIndex !== undefined) {
        resolvedIndex = options.useIndex;
      } else if (options?.sort) {
        resolvedIndex = this.findIndexForSort(options.sort);
      }
    }

    let p = this.hooks.prepareListInput(example || {}, resolvedIndex);
    p = this._cloneParams(p);
    if (resolvedIndex) p.IndexName = resolvedIndex;
    if (options?.consistent) p.ConsistentRead = true;
    if (options?.descending) p.ScanIndexForward = false;
    // Project either the caller's `keysOnly` shortcut or explicit fields.
    // `options.keysOnly: true` takes precedence — "I just want identities"
    // expands to the keyFields names. Otherwise honor `options.fields`
    // (REST-layer wildcards like `?fields=*keys` are already expanded
    // before we see them).
    if (project) {
      if (options?.keysOnly) {
        p = addProjection(
          p,
          this.keyFields.map(f => f.name),
          null,
          true
        );
      } else if (options?.fields) {
        p = addProjection(p, options.fields, this.projectionFieldMap);
      }
    }
    // `f-<field>-<op>=<value>` and `?search=<text>` translations have
    // moved to `getListByParams` so both entry points (`getList` via
    // example + options, and `getListByParams` via hand-built params)
    // apply filters consistently. `_buildListParams` stops at
    // example → base params + index / projection / consistency.
    return p;
  }
}

// Deprecated aliases — removed in a future minor (3.3.0 or 4.0.0). The 3.2.0
// naming cleanup unified the verb+qualifier pattern across the Adapter
// surface (individual / bulk-individual / list).
const warnedAliases = Object.create(null);
const warnOnce = (oldName, newName) => {
  if (warnedAliases[oldName]) return;
  warnedAliases[oldName] = true;
  console.warn(`dynamodb-toolkit: Adapter.${oldName} is deprecated, use Adapter.${newName}.`);
};
Adapter.prototype.putAll = function (items, options) {
  warnOnce('putAll', 'putItems');
  return this.putItems(items, options);
};
Adapter.prototype.getAll = function (options, example, index) {
  warnOnce('getAll', 'getList');
  return this.getList(options, example, index);
};
Adapter.prototype.getAllByParams = function (params, options) {
  warnOnce('getAllByParams', 'getListByParams');
  return this.getListByParams(params, options);
};
Adapter.prototype.deleteAllByParams = function (params, options) {
  warnOnce('deleteAllByParams', 'deleteListByParams');
  return this.deleteListByParams(params, options);
};
Adapter.prototype.cloneAllByParams = function (params, mapFn, options) {
  warnOnce('cloneAllByParams', 'cloneListByParams');
  return this.cloneListByParams(params, mapFn, options);
};
Adapter.prototype.moveAllByParams = function (params, mapFn, options) {
  warnOnce('moveAllByParams', 'moveListByParams');
  return this.moveListByParams(params, mapFn, options);
};
