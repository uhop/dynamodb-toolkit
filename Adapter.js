'use strict';

const applyTransaction = require('./utils/applyTransaction');
const addProjection = require('./utils/addProjection');
const {convertTo, convertFrom} = require('./utils/convertTypes');
const prepareUpdate = require('./utils/prepareUpdate');
const paginateList = require('./utils/paginateList');
const deleteList = require('./utils/deleteList');
const copyList = require('./utils/copyList');
const readList = require('./utils/readList');
const writeList = require('./utils/writeList');
const fieldsToMap = require('./utils/fieldsToMap');
const filtering = require('./utils/filtering');
const cleanParams = require('./utils/cleanParams');
const cloneParams = require('./utils/cloneParams');

class Raw {
  constructor(source) {
    Object.assign(this, source);
  }
  static make(source) {
    return new Raw(source);
  }
}

class Adapter {
  constructor(options) {
    // defaults
    this.keyFields = [];
    this.specialTypes = {};
    this.projectionFieldMap = {};
    this.searchable = {};
    this.searchablePrefix = '-search-';
    this.topLevelFieldMap = true;
    // overlay
    Object.assign(this, options);
  }

  static make(options) {
    return new Adapter(options);
  }

  // user-defined methods

  prepare(item, isPatch, deep) {
    // prepare to write it to a database
    // add some technical fields if required
    // returns a raw item
    return item;
  }

  prepareKey(key, index) {
    // prepare a key for a database
    // add some technical fields if required
    // returns a raw key object
    const rawKey = key instanceof Adapter.Raw ? key : this.prepare(key);
    return this.restrictKey(rawKey, index);
  }

  restrictKey(rawKey, index) {
    // remove unnecessary properties
    return this.keyFields.reduce((acc, key) => {
      if (rawKey.hasOwnProperty(key)) acc[key] = rawKey[key];
      return acc;
    }, new Adapter.Raw({}));
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

  revive(rawItem, fieldMap) {
    // reconstitute a database object
    // remove some technical fields if required
    return rawItem;
  }

  async validateItem(item, isPatch, deep) {
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
      item = this.toDynamo(item);
    }
    const params = cleanParams(this.updateParams(this.checkExistence({Item: item}, true), {name: 'post'}));
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

  async makePatch(key, item, deep, params) {
    const deleteProps = item.__delete;
    if (!(item instanceof Adapter.Raw)) {
      await this.validateItem(item, true, deep);
    }
    item = convertTo(this.prepare(item, true, deep), this.specialTypes);
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    params = this.checkExistence(params);
    this.keyFields.forEach(field => delete item[field]);
    if (deep) {
      params = prepareUpdate(item, params);
    } else {
      delete item.__delete;
      params = prepareUpdate.flat(item, deleteProps, params);
    }
    params = cleanParams(this.updateParams(params, {name: 'patch', deep}));
    return {action: 'patch', params};
  }

  async makeDelete(key, params) {
    params = await this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    params = cleanParams(this.updateParams(params, {name: 'delete'}));
    return {action: 'delete', params};
  }

  // general API

  async getByKey(key, fields, params, returnRaw) {
    const batch = await this.makeGet(key, fields, params);
    const data = await this.client.getItem(batch.params).promise();
    if (!data.Item) return; // undefined
    if (returnRaw) return new Adapter.Raw(data.Item);
    return this.fromDynamo(data.Item, fieldsToMap(fields, null, this.topLevelFieldMap));
  }

  async get(item, fields, params, returnRaw) {
    return this.getByKey(item, fields, params, returnRaw);
  }

  async post(item) {
    const batch = await this.makePost(item),
      checks = await this.checkConsistency(batch);
    if (checks) {
      return applyTransaction(this.client, checks, batch);
    }
    return this.client.putItem(batch.params).promise();
  }

  async put(item, force, params) {
    const batch = await this.makePut(item, force, params),
      checks = await this.checkConsistency(batch);
    if (checks) {
      return applyTransaction(this.client, checks, batch);
    }
    return this.client.putItem(batch.params).promise();
  }

  async patchByKey(key, item, deep, params) {
    const batch = await this.makePatch(key, item, deep, params),
      checks = await this.checkConsistency(batch);
    if (checks) {
      return applyTransaction(this.client, checks, batch);
    }
    return this.client.updateItem(batch.params).promise();
  }

  async patch(item, deep, params) {
    return this.patchByKey(item, item, deep, params);
  }

  async deleteByKey(key, params) {
    const batch = await this.makeDelete(key, params),
      checks = await this.checkConsistency(batch);
    if (checks) {
      return applyTransaction(this.client, checks, batch);
    }
    return this.client.deleteItem(batch.params).promise();
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

  // mass operations

  makeParams(options, project, params, skipSelect) {
    params = this.cloneParams(params);
    options.consistent && (params.ConsistentRead = true);
    options.descending && (params.ScanIndexForward = false);
    project && options.fields && addProjection(params, options.fields, this.projectionFieldMap, skipSelect);
    return filtering(options.filter, fieldsToMap(options.fields, null, this.topLevelFieldMap), this.searchable, this.searchablePrefix, params);
  }

  async scanAllByParams(params, fields, returnRaw) {
    params = this.cloneParams(params);
    const result = await readList.getItems(this.client, params);
    let transformFn;
    if (returnRaw) {
      transformFn = item => this.fromDynamo(item);
    } else {
      const fieldMap = fieldsToMap(fields, null, this.topLevelFieldMap);
      transformFn = item => this.fromDynamo(item, fieldMap);
    }
    return {nextParams: result.nextParams, items: result.items.map(transformFn)};
  }

  async getAllByParams(params, options, returnRaw) {
    params = this.cloneParams(params);
    const result = await paginateList(this.client, params, options);
    let transformFn;
    if (returnRaw) {
      transformFn = item => this.fromDynamo(item);
    } else {
      const fieldMap = fieldsToMap(options && options.fields, null, this.topLevelFieldMap);
      transformFn = item => this.fromDynamo(item, fieldMap);
    }
    result.data = result.data.map(transformFn);
    return result;
  }

  async getByKeys(keys, fields, params, returnRaw) {
    params = this.cloneParams(params);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const items = await readList.byKeys(
      this.client,
      this.table,
      keys.map(key => this.toDynamoKey(key, params.IndexName)),
      cleanParams(params)
    );
    let transformFn;
    if (returnRaw) {
      transformFn = item => this.fromDynamo(item);
    } else {
      const fieldMap = fieldsToMap(fields, null, this.topLevelFieldMap);
      transformFn = item => this.fromDynamo(item, fieldMap);
    }
    return items.map(transformFn);
  }

  async getAll(options, item, index, returnRaw) {
    const params = this.makeListParams(options, true, item, index);
    return this.getAllByParams(params, options, returnRaw);
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

  // generic implementations

  // async get(item, fields, params) { /* see above */ }
  // async patch(item, deep, params) { /* see above */ }
  // async delete(item, params) { /* see above */ }

  // async cloneByKey(key, mapFn, force, params) { /* see above */ }
  // async clone(item, mapFn, force, params) { /* see above */ }

  // async getAll(options, item, index) { /* see above */ }
  // async deleteAll(options, item, index) { /* see above */ }
  // async cloneAll(options, mapFn, item, index) { /* see above */ }

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
        items = result.items.map(item => this.fromDynamo(item, null, true));
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

  fromDynamo(item, fieldMap, returnRaw) {
    const rawItem = convertFrom(item);
    if (returnRaw) return new Adapter.Raw(rawItem);
    return this.revive(rawItem, fieldMap);
  }

  toDynamo(item) {
    return convertTo(this.prepare(item), this.specialTypes);
  }

  toDynamoKey(key, index) {
    return convertTo(this.prepareKey(key, index), this.specialTypes);
  }

  async validateItems(items, isPatch, deep) {
    for (let i = 0; i < items.length; ++i) {
      await this.validateItem(items[i], isPatch, deep);
    }
  }
}

Adapter.Raw = Raw;
Adapter.adapt = Adapter.make;

module.exports = Adapter;
