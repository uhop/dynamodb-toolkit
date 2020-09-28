'use strict';

const applyTransaction = require('./utils/applyTransaction');
const addProjection = require('./utils/addProjection');
const converter = require('./utils/converter');
const {convertTo, convertFrom} = require('./utils/convertTypes');
const prepareUpdate = require('./utils/prepareUpdate');
const paginateList = require('./utils/paginateList');
const deleteList = require('./utils/deleteList');
const copyList = require('./utils/copyList');
const moveList = require('./utils/moveList');
const readList = require('./utils/readList');
const readOrderedListByKeys = require('./utils/readOrderedListByKeys');
const writeList = require('./utils/writeList');
const filtering = require('./utils/filtering');
const cleanParams = require('./utils/cleanParams');
const cloneParams = require('./utils/cloneParams');
const subsetObject = require('./utils/subsetObject');

class Raw {
  constructor(source) {
    Object.assign(this, source);
  }
  static make(source) {
    return new Raw(source);
  }
}

class DbRaw extends Raw {
  static make(source) {
    return new DbRaw(source);
  }
}

class Adapter {
  constructor(options) {
    // set defaults
    this.converter = converter;
    this.converterOptions = null;
    this.keyFields = [];
    this.specialTypes = {};
    this.projectionFieldMap = {};
    this.searchable = {};
    this.searchablePrefix = '-search-';
    // overlay
    Object.assign(this, options);
    // add calculated fields
    this.isDocClient = typeof this.client.createSet == 'function';
  }

  static make(options) {
    return new Adapter(options);
  }

  // user-defined methods

  prepare(item, isPatch) {
    // prepare to write it to a database
    // add some technical fields if required
    // returns a raw item
    return item;
  }

  prepareKey(key, index) {
    // prepare a key for a database
    // add some technical fields if required
    // returns a raw key object
    const rawKey = this.prepare(key);
    return this.restrictKey(rawKey, index);
  }

  restrictKey(rawKey, index) {
    // remove unnecessary properties
    return this.keyFields.reduce((acc, key) => {
      if (rawKey.hasOwnProperty(key)) acc[key] = rawKey[key];
      return acc;
    }, {});
  }

  prepareListParams(item, index) {
    // prepare params to list objects in a database
    // add some technical fields if required
    return {};
  }

  updateParams(params, options) {
    // this function can update params by adding a writing condition
    return params;
  }

  revive(rawItem, fields) {
    // reconstitute a database object
    // remove some technical fields if required
    if (fields) return subsetObject(rawItem, fields);
    return rawItem;
  }

  isIndirectIndex(index) {
    return false;
  }

  async validateItem(item, isPatch) {
    // this function should throw an exception if an item should not be written to DB
  }

  async checkConsistency(batch) {
    // this function returns consistency checks for other items, e.g., parents
    return null;
  }

  // batch operations

  async makeGet(key, fields, params) {
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    return {action: 'get', adapter: this, params: cleanParams(params)};
  }

  async makeCheck(key, params) {
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    return {action: 'check', params: cleanParams(params)};
  }

  async makePost(item) {
    if (!(item instanceof Adapter.Raw)) {
      await this.validateItem(item);
    }
    const params = cleanParams(this.updateParams(this.checkExistence({Item: this.toDynamo(item)}, true), {name: 'post'}));
    return {action: 'put', params};
  }

  async makePut(item, force, params) {
    if (!(item instanceof Adapter.Raw)) {
      await this.validateItem(item);
    }
    params = this.cloneParams(params);
    params.Item = this.toDynamo(item);
    !force && (params = this.checkExistence(params));
    params = cleanParams(this.updateParams(params, {name: 'put', force}));
    return {action: 'put', params};
  }

  async makePatch(key, item, params) {
    const deleteProps = item.__delete;
    if (this.isDocClient) {
      if (item instanceof Adapter.DbRaw) {
        item = this.convertFrom(item);
      } else if (item instanceof Adapter.Raw) {
        // do nothing, we are good already
      } else {
        await this.validateItem(item, true);
        item = this.prepare(item, true);
      }
    } else {
      if (item instanceof Adapter.DbRaw) {
        // do nothing, we are good already
      } else if (item instanceof Adapter.Raw) {
        item = this.convertTo(item);
      } else {
        await this.validateItem(item, true);
        item = this.convertTo(this.prepare(item, true));
      }
    }
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    params = this.checkExistence(params);
    this.keyFields.forEach(field => delete item[field]);
    delete item.__delete;
    params = prepareUpdate(item, deleteProps, params);
    params = cleanParams(this.updateParams(params, {name: 'patch'}));
    return {action: 'patch', params};
  }

  async makeDelete(key, params) {
    params = await this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    params = cleanParams(this.updateParams(params, {name: 'delete'}));
    return {action: 'delete', params};
  }

  // general API

  async getByKey(key, fields, params, returnRaw, ignoreIndirection) {
    const isIndirect = !ignoreIndirection && params && params.IndexName && this.isIndirectIndex(params.IndexName),
      batch = await this.makeGet(key, isIndirect ? this.keyFields : fields, params),
      action = this.isDocClient ? 'get' : 'getItem';
    let data = await this.client[action](batch.params).promise();
    if (!data.Item) return; // undefined
    if (isIndirect) {
      const indirectParam = this.cloneParams(params);
      indirectParam && delete indirectParam.IndexName;
      const indirectBatch = await this.makeGet(this.markAsRaw(this.restrictKey(data.Item)), fields, params);
      data = await this.client[action](indirectBatch.params).promise();
    }
    return this.fromDynamo(data.Item, fields, returnRaw);
  }

  async get(item, fields, params, returnRaw, ignoreIndirection) {
    return this.getByKey(item, fields, params, returnRaw, ignoreIndirection);
  }

  async post(item) {
    const batch = await this.makePost(item),
      checks = await this.checkConsistency(batch);
    if (checks) {
      return applyTransaction(this.client, checks, batch);
    }
    const action = this.isDocClient ? 'put' : 'putItem';
    return this.client[action](batch.params).promise();
  }

  async put(item, force, params) {
    const batch = await this.makePut(item, force, params),
      checks = await this.checkConsistency(batch);
    if (checks) {
      return applyTransaction(this.client, checks, batch);
    }
    const action = this.isDocClient ? 'put' : 'putItem';
    return this.client[action](batch.params).promise();
  }

  async patchByKey(key, item, params) {
    const batch = await this.makePatch(key, item, params),
      checks = await this.checkConsistency(batch);
    if (checks) {
      return applyTransaction(this.client, checks, batch);
    }
    const action = this.isDocClient ? 'update' : 'updateItem';
    return this.client[action](batch.params).promise();
  }

  async patch(item, params) {
    return this.patchByKey(item, item, params);
  }

  async deleteByKey(key, params) {
    const batch = await this.makeDelete(key, params),
      checks = await this.checkConsistency(batch);
    if (checks) {
      return applyTransaction(this.client, checks, batch);
    }
    const action = this.isDocClient ? 'delete' : 'deleteItem';
    return this.client[action](batch.params).promise();
  }

  async delete(item, params) {
    return this.deleteByKey(item, params);
  }

  async cloneByKey(key, mapFn, force, params, returnRaw) {
    const item = await this.getByKey(key, null, this.cleanGetParams(params), returnRaw);
    if (typeof item == 'undefined') return false;
    const clonedItem = mapFn(item);
    if (force) {
      await this.put(clonedItem, true, params);
    } else {
      await this.post(clonedItem);
    }
    return true;
  }

  async clone(item, mapFn, force, params, returnRaw) {
    return this.cloneByKey(item, mapFn, force, params, returnRaw);
  }

  async moveByKey(key, mapFn, force, params, returnRaw) {
    const item = await this.getByKey(key, null, this.cleanGetParams(params), returnRaw);
    if (typeof item == 'undefined') return false;
    const clonedItem = mapFn(item),
      writeBatch = await (force ? this.makePut(clonedItem, true, params) : this.makePost(clonedItem)),
      writeChecks = await this.checkConsistency(writeBatch),
      deleteBatch = await this.makeDelete(key, params),
      deleteChecks = await this.checkConsistency(deleteBatch);
    await applyTransaction(this.client, writeChecks, writeBatch, deleteChecks, deleteBatch);
    return true;
  }

  async move(item, mapFn, force, params, returnRaw) {
    return this.moveByKey(item, mapFn, force, params, returnRaw);
  }

  // mass operations

  makeParams(options, project, params, skipSelect) {
    params = this.cloneParams(params);
    options.consistent && (params.ConsistentRead = true);
    options.descending && (params.ScanIndexForward = false);
    project && options.fields && addProjection(params, options.fields, this.projectionFieldMap, skipSelect);
    return filtering(options.filter, this.searchable, {
      fields: options.fields,
      isDocClient: this.isDocClient,
      params
    });
  }

  async scanAllByParams(params, fields, returnRaw, ignoreIndirection) {
    const isIndirect = !ignoreIndirection && params && params.IndexName && this.isIndirectIndex(params.IndexName),
      activeFields = isIndirect ? this.keyFields : fields;
    let activeParams = this.cloneParams(params);
    activeFields && addProjection(activeParams, activeFields, this.projectionFieldMap, true);
    activeParams = cleanParams(activeParams);
    const result = await readList.getItems(this.client, activeParams);
    if (isIndirect && result.items.length) {
      let indirectParam = this.cloneParams(params);
      indirectParam && delete indirectParam.IndexName;
      indirectParam = cleanParams(indirectParam);
      result.items = await readOrderedListByKeys(
        this.client,
        this.table,
        result.items.map(item => this.restrictKey(item)),
        indirectParam
      );
      result.items = result.items.filter(item => item);
    }
    let transformFn;
    if (returnRaw === 'db-raw' || returnRaw === 'raw') {
      transformFn = item => this.fromDynamo(item, null, returnRaw);
    } else {
      transformFn = item => this.fromDynamo(item, fields);
    }
    return {nextParams: result.nextParams, items: result.items.map(transformFn)};
  }

  async getAllByParams(params, options, returnRaw, ignoreIndirection) {
    const isIndirect = !ignoreIndirection && params && params.IndexName && this.isIndirectIndex(params.IndexName),
      activeOptions = {...options};
    isIndirect && (activeOptions.fields = this.keyFields);
    params = cleanParams(this.cloneParams(params));
    const result = await paginateList(this.client, params, activeOptions);
    if (isIndirect && result.data.length) {
      let indirectParam = this.cloneParams(params);
      indirectParam && delete indirectParam.IndexName;
      indirectParam = cleanParams(indirectParam);
      result.data = await readOrderedListByKeys(
        this.client,
        this.table,
        result.data.map(item => this.restrictKey(item)),
        indirectParam
      );
      result.data = result.data.filter(item => item);
    }
    let transformFn;
    if (returnRaw === 'db-raw' || returnRaw === 'raw') {
      transformFn = item => this.fromDynamo(item, null, returnRaw);
    } else {
      transformFn = item => this.fromDynamo(item, options && options.fields);
    }
    result.data = result.data.map(transformFn);
    return result;
  }

  async getByKeys(keys, fields, params, returnRaw, ignoreIndirection) {
    const isIndirect = !ignoreIndirection && params && params.IndexName && this.isIndirectIndex(params.IndexName),
      activeFields = isIndirect ? this.keyFields : fields;
    let activeParams = this.cloneParams(params);
    activeFields && addProjection(activeParams, activeFields, this.projectionFieldMap, true);
    activeParams = cleanParams(activeParams);
    let items = await readList.byKeys(
      this.client,
      this.table,
      keys.map(key => this.toDynamoKey(key, activeParams.IndexName)),
      activeParams
    );
    if (isIndirect && items.length) {
      let indirectParam = this.cloneParams(params);
      indirectParam && delete indirectParam.IndexName;
      indirectParam = cleanParams(indirectParam);
      items = await readList.byKeys(
        this.client,
        this.table,
        items.map(item => this.restrictKey(item)),
        indirectParam
      );
    }
    let transformFn;
    if (returnRaw === 'db-raw' || returnRaw === 'raw') {
      transformFn = item => this.fromDynamo(item, null, returnRaw);
    } else {
      transformFn = item => this.fromDynamo(item, fields);
    }
    return items.map(transformFn);
  }

  async getAll(options, item, index, returnRaw, ignoreIndirection) {
    const params = this.makeListParams(options, true, item, index);
    return this.getAllByParams(params, options, returnRaw, ignoreIndirection);
  }

  async putAll(items) {
    return writeList(this.client, this.table, items, item => this.toDynamo(item));
  }

  async deleteAllByParams(params) {
    params = this.cloneParams(params);
    params = this.addKeyFields(params, true);
    return deleteList(this.client, params);
  }

  async deleteByKeys(keys) {
    return deleteList.byKeys(
      this.client,
      this.table,
      keys.map(key => this.toDynamoKey(key))
    );
  }

  async deleteAll(options, item, index) {
    const params = this.makeListParams(options, false, item, index);
    return this.deleteAllByParams(params);
  }

  async cloneAllByParams(params, mapFn, returnRaw) {
    params = this.cloneParams(params);
    params = this.addKeyFields(params, true);
    return copyList.viaKeys(this.client, params, item => this.toDynamo(mapFn(this.fromDynamo(item, null, returnRaw))));
  }

  async cloneByKeys(keys, mapFn, returnRaw) {
    return copyList.byKeys(
      this.client,
      this.table,
      keys.map(key => this.toDynamoKey(key)),
      item => this.toDynamo(mapFn(this.fromDynamo(item, null, returnRaw)))
    );
  }

  async cloneAll(options, mapFn, item, index, returnRaw) {
    const params = this.makeListParams(options, false, item, index);
    return this.cloneAllByParams(params, mapFn, returnRaw);
  }

  async moveAllByParams(params, mapFn, returnRaw) {
    params = this.cloneParams(params);
    params = this.addKeyFields(params, true);
    const fn = item => this.toDynamo(mapFn(this.fromDynamo(item, null, returnRaw))),
      result = await moveList.viaKeys(this.client, params, fn);
    return result;
  }

  async moveByKeys(keys, mapFn, returnRaw) {
    const rawKeys = keys.map(key => this.toDynamoKey(key)),
      fn = item => this.toDynamo(mapFn(this.fromDynamo(item, null, returnRaw))),
      result = await moveList.byKeys(this.client, this.table, rawKeys, fn);
    return result;
  }

  async moveAll(options, mapFn, item, index, returnRaw) {
    const params = this.makeListParams(options, false, item, index),
      result = await this.moveAllByParams(params, mapFn, returnRaw);
    return result;
  }

  // generic implementations

  // async get(item, fields, params) { /* see above */ }
  // async patch(item, params) { /* see above */ }
  // async delete(item, params) { /* see above */ }

  // async cloneByKey(key, mapFn, force, params) { /* see above */ }
  // async clone(item, mapFn, force, params) { /* see above */ }
  // async moveByKey(key, mapFn, force, params) { /* see above */ }
  // async move(item, mapFn, force, params) { /* see above */ }

  // async getAll(options, item, index) { /* see above */ }
  // async deleteAll(options, item, index) { /* see above */ }
  // async cloneAll(options, mapFn, item, index) { /* see above */ }
  // async moveAll(options, mapFn, item, index) { /* see above */ }

  async genericGetByKeys(keys, fields, params, returnRaw) {
    params = this.cloneParams(params);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const results = [];
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i],
        result = await this.getByKey(key, null, params, returnRaw);
      typeof result != 'undefined' && results.push(result);
    }
    return results;
  }

  async genericPutAll(items) {
    for (let i = 0; i < items.length; ++i) {
      const item = items[i];
      await this.put(item, true);
    }
  }

  async genericDeleteAllByParams(params) {
    params = this.cloneParams(params);
    params = this.addKeyFields(params, true);
    let processed = 0;
    while (params) {
      const result = await readList.getItems(this.client, params),
        items = result.items.map(item => this.fromDynamo(item, null));
      processed += await this.deleteByKeys(items);
      params = result.nextParams;
    }
    return processed;
  }

  async genericDeleteByKeys(keys) {
    let processed = 0;
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      const result = await this.deleteByKey(key);
      processed += typeof result == 'number' ? result : result ? 1 : 0;
    }
    return processed;
  }

  async genericCloneAllByParams(params, mapFn, returnRaw) {
    params = this.cloneParams(params);
    params = this.addKeyFields(params, true);
    let processed = 0;
    while (params) {
      const result = await readList.getItems(this.client, params),
        items = result.items.map(item => this.restrictKey(new Adapter.DbRaw(item)));
      processed += await this.cloneByKeys(items, mapFn, returnRaw);
      params = result.nextParams;
    }
    return processed;
  }

  async genericCloneByKeys(keys, mapFn, returnRaw) {
    let processed = 0;
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      const result = await this.cloneByKey(key, mapFn, true, null, returnRaw);
      processed += typeof result == 'number' ? result : result ? 1 : 0;
    }
    return processed;
  }

  async genericMoveAllByParams(params, mapFn, returnRaw) {
    params = this.cloneParams(params);
    params = this.addKeyFields(params, true);
    let processed = 0;
    while (params) {
      const result = await readList.getItems(this.client, params),
        items = result.items.map(item => this.restrictKey(new Adapter.DbRaw(item)));
      processed += await this.moveByKeys(items, mapFn, returnRaw);
      params = result.nextParams;
    }
    return processed;
  }

  async genericMoveByKeys(keys, mapFn, returnRaw) {
    let processed = 0;
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      const result = await this.moveByKey(key, mapFn, true, null, returnRaw);
      processed += typeof result == 'number' ? result : result ? 1 : 0;
    }
    return processed;
  }

  // utilities

  cloneParams(params) {
    params = cloneParams(params);
    params.TableName = this.table;
    return params;
  }

  cleanGetParams(params) {
    params = this.cloneParams(params);
    delete params.ConditionExpression;
    return cleanParams(params);
  }

  checkExistence(params, invert) {
    params = this.cloneParams(params);
    const names = params.ExpressionAttributeNames || {},
      keyName = '#k' + Object.keys(names).length,
      condition = `attribute_${invert ? 'not_' : ''}exists(${keyName})`;
    names[keyName] = this.keyFields[0];
    params.ExpressionAttributeNames = names;
    params.ConditionExpression = params.ConditionExpression ? `${condition} AND (${params.ConditionExpression})` : condition;
    return params;
  }

  makeListParams(options, project, item, index) {
    return this.makeParams(options, project, this.prepareListParams(item, index));
  }

  addKeyFields(params, skipSelect) {
    return addProjection(params, this.keyFields.join(','), null, skipSelect);
  }

  convertFrom(item, ignoreSpecialTypes) {
    return convertFrom(this.converter, item, ignoreSpecialTypes ? null : this.specialTypes, this.converterOptions);
  }

  convertTo(item, ignoreSpecialTypes) {
    return convertTo(this.converter, item, ignoreSpecialTypes ? null : this.specialTypes, this.converterOptions);
  }

  fromDynamo(item, fields, returnRaw) {
    if (this.isDocClient) {
      if (returnRaw === 'db-raw') return new Adapter.DbRaw(this.convertTo(item));
      if (returnRaw === 'raw') return new Adapter.Raw(item);
      return this.revive(item, fields);
    }
    if (returnRaw === 'db-raw') return new Adapter.DbRaw(item);
    const rawItem = this.convertFrom(item);
    if (returnRaw === 'raw') return new Adapter.Raw(rawItem);
    return this.revive(rawItem, fields);
  }

  toDynamo(item) {
    if (this.isDocClient) {
      if (item instanceof Adapter.DbRaw) return this.convertFrom(item);
      if (item instanceof Adapter.Raw) return item;
      return this.prepare(item);
    }
    if (item instanceof Adapter.DbRaw) return item;
    if (item instanceof Adapter.Raw) return this.convertTo(item);
    return this.convertTo(this.prepare(item));
  }

  toDynamoKey(key, index) {
    if (this.isDocClient) {
      if (key instanceof Adapter.DbRaw) return this.convertFrom(this.restrictKey(key, index));
      if (key instanceof Adapter.Raw) return this.restrictKey(key, index);
      return this.prepareKey(key, index);
    }
    if (key instanceof Adapter.DbRaw) return this.restrictKey(key, index);
    if (key instanceof Adapter.Raw) return this.convertTo(this.restrictKey(key, index));
    return this.convertTo(this.prepareKey(key, index));
  }

  fromDynamoRaw(item) {
    return this.isDocClient ? item : this.convertFrom(item, true);
  }

  toDynamoRaw(item) {
    return this.isDocClient ? item : this.convertTo(item, true);
  }

  markAsRaw(rawItem) {
    return new (this.isDocClient ? Adapter.Raw : Adapter.DbRaw)(rawItem);
  }

  async validateItems(items, isPatch) {
    for (let i = 0; i < items.length; ++i) {
      await this.validateItem(items[i], isPatch);
    }
  }
}

Adapter.Raw = Raw;
Adapter.DbRaw = DbRaw;
Adapter.adapt = Adapter.make;

module.exports = Adapter;
