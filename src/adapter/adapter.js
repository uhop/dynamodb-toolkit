// Adapter — composition root tying expressions, batch, mass, paths, and hooks together.

import {GetCommand} from '@aws-sdk/lib-dynamodb';

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
import {writeList} from '../mass/write-list.js';
import {deleteList, deleteByKeys} from '../mass/delete-list.js';
import {copyList} from '../mass/copy-list.js';
import {moveList} from '../mass/move-list.js';

import {defaultHooks, restrictKey} from './hooks.js';
import {dispatchWrite} from './transaction-upgrade.js';

const MOVE_CHUNK = 12;

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
    // sort key out of multiple component fields.
    if (options.structuralKey !== undefined) {
      if (typeof options.structuralKey !== 'object' || typeof options.structuralKey.name !== 'string') {
        throw new Error("options.structuralKey must be {name: string, separator?: string}");
      }
      const sep = options.structuralKey.separator;
      if (sep !== undefined && typeof sep !== 'string') {
        throw new Error('options.structuralKey.separator must be a string');
      }
      this.structuralKey = {name: options.structuralKey.name, separator: sep === undefined ? '|' : sep};
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
    // named field is present on the item.
    if (options.typeDiscriminator !== undefined) {
      if (typeof options.typeDiscriminator !== 'object' || typeof options.typeDiscriminator.name !== 'string') {
        throw new Error('options.typeDiscriminator must be {name: string}');
      }
      this.typeDiscriminator = {name: options.typeDiscriminator.name};
    }

    this.client = options.client;
    this.table = options.table;
    this.projectionFieldMap = options.projectionFieldMap || {};
    this.searchable = options.searchable || {};
    this.searchablePrefix = options.searchablePrefix || '-search-';
    this.indirectIndices = options.indirectIndices || {};
    this.hooks = {...defaultHooks, ...(options.hooks || {})};
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
    const sep = this.structuralKey.separator;
    const base = components.join(sep);
    if (kind === 'exact') {
      return buildKeyCondition({name: this.structuralKey.name, value: base, kind: 'exact'}, params);
    }
    if (kind === 'children') {
      return buildKeyCondition({name: this.structuralKey.name, value: base + sep, kind: 'prefix'}, params);
    }
    // kind === 'partial'
    if (typeof partial !== 'string' || partial.length === 0) {
      throw new Error("buildKey: kind 'partial' requires options.partial to be a non-empty string");
    }
    return buildKeyCondition({name: this.structuralKey.name, value: base + sep + partial, kind: 'prefix'}, params);
  }

  // --- internal helpers ---

  _cloneParams(params) {
    const p = cloneParams(params || {});
    p.TableName = this.table;
    return p;
  }

  _restrictKey(rawKey) {
    return restrictKey(rawKey, this.keyFields.map(f => f.name));
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
    return Boolean(idx && this.indirectIndices[idx] === 1);
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
    let p = {TableName: this.table, Item: this._prepareItem(item)};
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
    p.Item = this._prepareItem(item);
    if (!force) p = this._checkExistence(p);
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

    let p = this._cloneParams(options?.params);
    p.Key = this._toKey(key, p.IndexName);
    p = this._checkExistence(p);
    if (options?.conditions) p = buildCondition(options.conditions, p);
    p = buildUpdate(payload, {delete: options?.delete, separator: options?.separator, arrayOps: options?.arrayOps}, p);
    if (options?.returnFailedItem) p.ReturnValuesOnConditionCheckFailure = 'ALL_OLD';
    p = this.hooks.updateInput(p, {name: 'patch'});
    return {action: 'patch', params: cleanParams(p)};
  }

  /** @returns {Promise<{action: 'delete', params: any}>} */
  async makeDelete(key, options) {
    let p = this._cloneParams(options?.params);
    p.Key = this._toKey(key, p.IndexName);
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

  async delete(key, options) {
    const batch = await this.makeDelete(key, options);
    const checks = await this.hooks.checkConsistency(batch);
    return dispatchWrite(this.client, batch, checks);
  }

  // --- reads ---

  async getByKey(key, fields, options) {
    const params = options?.params;
    const isIndirect = this._isIndirect(params, options);
    const activeFields = isIndirect ? this.keyFields.map(f => f.name) : fields;
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
    const activeFields = isIndirect ? this.keyFields.map(f => f.name) : fields;

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

  async getAll(options, example, index) {
    const params = await this._buildListParams(options, true, example, index);
    return this.getAllByParams(params, options);
  }

  async getAllByParams(params, options) {
    const isIndirect = this._isIndirect(params, options);
    let activeParams = this._cloneParams(params);
    if (isIndirect) {
      delete activeParams.ProjectionExpression;
      activeParams = addProjection(
        activeParams,
        this.keyFields.map(f => f.name),
        null,
        true
      );
    }
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

  async putAll(items, options) {
    const strategy = options?.strategy || 'native';
    if (strategy === 'sequential') {
      let processed = 0;
      for (const item of items) {
        await this.put(item, {force: true, params: options?.params});
        processed++;
      }
      return {processed};
    }
    const processed = await writeList(this.client, this.table, items, item => this._prepareItem(item));
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

  async deleteAllByParams(params, _options) {
    let p = this._cloneParams(params);
    p = addProjection(
      p,
      this.keyFields.map(f => f.name).join(','),
      null,
      true
    );
    p = cleanParams(p);
    const processed = await deleteList(this.client, p, item => this._restrictKey(item));
    return {processed};
  }

  async cloneByKeys(keys, mapFn, _options) {
    const dynamoKeys = keys.map(k => this._toKey(k));
    const items = await readByKeys(this.client, this.table, dynamoKeys);
    const cloned = items.filter(Boolean).map(item => {
      const revived = this.hooks.revive(item);
      const mapped = mapFn ? mapFn(revived) : revived;
      return this._prepareItem(mapped);
    });
    if (!cloned.length) return {processed: 0};
    const processed = await writeList(this.client, this.table, cloned);
    return {processed};
  }

  async cloneAllByParams(params, mapFn, _options) {
    let p = this._cloneParams(params);
    p = cleanParams(p);
    const fn = item => {
      const revived = this.hooks.revive(item);
      const mapped = mapFn ? mapFn(revived) : revived;
      return this._prepareItem(mapped);
    };
    const processed = await copyList(this.client, p, fn);
    return {processed};
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
        const mapped = mapFn ? mapFn(revived) : revived;
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

  async moveAllByParams(params, mapFn, _options) {
    let p = this._cloneParams(params);
    p = addProjection(
      p,
      this.keyFields.map(f => f.name).join(','),
      null,
      true
    );
    p = cleanParams(p);
    const itemMapper = item => {
      const revived = this.hooks.revive(item);
      const mapped = mapFn ? mapFn(revived) : revived;
      return this._prepareItem(mapped);
    };
    const keyMapper = item => this._restrictKey(item);
    const processed = await moveList(this.client, p, itemMapper, keyMapper);
    return {processed};
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
    let p = this.hooks.prepareListInput(example || {}, index);
    p = this._cloneParams(p);
    if (index) p.IndexName = index;
    if (options?.consistent) p.ConsistentRead = true;
    if (options?.descending) p.ScanIndexForward = false;
    if (project && options?.fields) {
      p = addProjection(p, options.fields, this.projectionFieldMap);
    }
    if (options?.filter) {
      p = buildFilter(
        this.searchable,
        options.filter,
        {fields: options.fields, prefix: this.searchablePrefix, caseSensitive: options.caseSensitive},
        p
      );
    }
    return p;
  }
}
