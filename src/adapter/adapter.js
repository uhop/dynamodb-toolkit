// Adapter — composition root tying expressions, batch, mass, paths, and hooks together.

import {GetCommand} from '@aws-sdk/lib-dynamodb';

import {Raw} from '../raw.js';
import {addProjection} from '../expressions/projection.js';
import {buildUpdate} from '../expressions/update.js';
import {buildCondition} from '../expressions/condition.js';
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

export class Adapter {
  constructor(options) {
    if (!options) throw new Error('AdapterOptions are required');
    if (!options.client) throw new Error('options.client (DynamoDBDocumentClient) is required');
    if (!options.table) throw new Error('options.table is required');
    if (!Array.isArray(options.keyFields) || !options.keyFields.length) {
      throw new Error('options.keyFields must be a non-empty array');
    }

    this.client = options.client;
    this.table = options.table;
    this.keyFields = options.keyFields;
    this.projectionFieldMap = options.projectionFieldMap || {};
    this.searchable = options.searchable || {};
    this.searchablePrefix = options.searchablePrefix || '-search-';
    this.indirectIndices = options.indirectIndices || {};
    this.hooks = {...defaultHooks, ...(options.hooks || {})};
  }

  // --- internal helpers ---

  _cloneParams(params) {
    const p = cloneParams(params || {});
    p.TableName = this.table;
    return p;
  }

  _restrictKey(rawKey) {
    return restrictKey(rawKey, this.keyFields);
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
    names[alias] = this.keyFields[0];
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
    for (const f of this.keyFields) delete payload[f];

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
    const activeFields = isIndirect ? this.keyFields : fields;
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
    const activeFields = isIndirect ? this.keyFields : fields;

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
      activeParams = addProjection(activeParams, this.keyFields, null, true);
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
    p = addProjection(p, this.keyFields.join(','), null, true);
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
    p = addProjection(p, this.keyFields.join(','), null, true);
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
