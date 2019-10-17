'use strict';

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
    return item;
  }

  prepareKey(item, index) {
    // prepare a key for a database
    // add some technical fields if required
    item = this.prepare(item);
    return this.keyFields.reduce((acc, key) => {
      if (item.hasOwnProperty(key)) acc[key] = item[key];
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

  revive(item, fieldMap) {
    // reconstitute a database object
    // remove some technical fields if required
    return item;
  }

  async validateItem(item, isPatch, deep) {
    // this function should throw an exception if an item should not be written to DB
  }

  // general API

  async getByKey(key, fields, params) {
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const data = await this.client.getItem(cleanParams(params)).promise();
    return data.Item ? this.fromDynamo(data.Item, fieldsToMap(fields, null, this.topLevelFieldMap)) : undefined;
  }

  async get(item, fields, params) {
    return this.getByKey(item, fields, params);
  }

  async post(item) {
    await this.validateItem(item);
    const params = cleanParams(this.updateParams(this.checkExistence({Item: this.toDynamo(item)}, true), {name: 'post'}));
    return this.client.putItem(params).promise();
  }

  async put(item, force, params) {
    await this.validateItem(item);
    params = this.cloneParams(params);
    params.Item = this.toDynamo(item);
    !force && (params = this.checkExistence(params));
    params = cleanParams(this.updateParams(params, {name: 'put', force}));
    return this.client.putItem(params).promise();
  }

  async patchByKey(key, item, deep, params) {
    await this.validateItem(item, true, deep);
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    params = this.checkExistence(params);
    const dbItem = convertTo(this.prepare(item, true, deep), this.specialTypes);
    this.keyFields.forEach(field => delete dbItem[field]);
    if (deep) {
      params = prepareUpdate(dbItem, params);
    } else {
      const deleteProps = item.__delete;
      delete dbItem.__delete;
      params = prepareUpdate.flat(dbItem, deleteProps, params);
    }
    params = cleanParams(this.updateParams(params, {name: 'patch', deep}));
    return params.UpdateExpression ? this.client.updateItem(params).promise() : null;
  }

  async patch(item, deep, params) {
    return this.patchByKey(item, item, deep, params);
  }

  async deleteByKey(key, params) {
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    params = cleanParams(this.updateParams(params, {name: 'delete'}));
    return this.client.deleteItem(params).promise();
  }

  async delete(item, params) {
    return this.deleteByKey(item, params);
  }

  async cloneByKey(key, mapFn, force, params) {
    const item = await this.getByKey(key, null, this.cleanGetParams(params));
    if (typeof item == 'undefined') return false;
    const clonedItem = mapFn(item);
    if (force) {
      await this.put(clonedItem, true, params);
    } else {
      await this.post(clonedItem);
    }
    return true;
  }

  async clone(item, mapFn, force, params) {
    return this.cloneByKey(item, mapFn, force, params);
  }

  // mass operations

  makeParams(options, project, params, skipSelect) {
    params = this.cloneParams(params);
    options.consistent && (params.ConsistentRead = true);
    options.descending && (params.ScanIndexForward = false);
    project && options.fields && addProjection(params, options.fields, this.projectionFieldMap, skipSelect);
    return filtering(options.filter, fieldsToMap(options.fields, null, this.topLevelFieldMap), this.searchable, this.searchablePrefix, params);
  }

  async scanAllByParams(params, fieldMap) {
    params = this.cloneParams(params);
    const result = await readList.getItems(this.client, params);
    fieldMap = fieldsToMap(fieldMap, null, this.topLevelFieldMap);
    return {nextParams: result.nextParams, items: result.items.map(item => this.fromDynamo(item, fieldMap))};
  }

  async getAllByParams(params, options, fields) {
    params = this.cloneParams(params);
    const result = await paginateList(this.client, params, options);
    const fieldMap = fieldsToMap(fields, null, this.topLevelFieldMap);
    result.data = result.data.map(item => this.fromDynamo(item, fieldMap));
    return result;
  }

  async getByKeys(keys, fields, params) {
    params = this.cloneParams(params);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const items = await readList.byKeys(this.client, this.table, keys.map(key => this.toDynamoKey(key, params.IndexName)), params);
    const fieldMap = fieldsToMap(fields, null, this.topLevelFieldMap);
    return items.map(item => this.fromDynamo(item, fieldMap));
  }

  async getAll(options, item, index) {
    const params = this.makeListParams(options, true, item, index);
    return this.getAllByParams(params, options, options && options.fields);
  }

  async putAll(items) {
    return writeList(this.client, this.table, items, item => this.toDynamo(item));
  }

  async deleteAllByParams(params) {
    params = this.cloneParams(params);
    addProjection(params, this.keyFields.join(','));
    return deleteList(this.client, params);
  }

  async deleteByKeys(keys) {
    return deleteList.byKeys(this.client, this.table, keys.map(key => this.toDynamoKey(key)));
  }

  async deleteAll(options, item, index) {
    const params = this.makeListParams(options, false, item, index);
    return this.deleteAllByParams(params);
  }

  async cloneAllByParams(params, mapFn) {
    params = this.cloneParams(params);
    addProjection(params, this.keyFields.join(','));
    return copyList.viaKeys(this.client, params, item => this.toDynamo(mapFn(this.fromDynamo(item))));
  }

  async cloneByKeys(keys, mapFn) {
    return copyList.byKeys(this.client, this.table, keys.map(key => this.toDynamoKey(key)), item => this.toDynamo(mapFn(this.fromDynamo(item))));
  }

  async cloneAll(options, mapFn, item, index) {
    const params = this.makeListParams(options, false, item, index);
    return this.cloneAllByParams(params, mapFn);
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

  async genericGetByKeys(keys, fields, params) {
    params = this.cloneParams(params);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const results = await Promise.all(keys.map(key => this.getByKey(key, null, params)));
    return results.filter(item => typeof item != 'undefined');
  }

  async genericPutAll(items) {
    return Promise.all(items.map(item => this.put(item, true)));
  }

  async genericDeleteAllByParams(params) {
    params = this.cloneParams(params);
    const fieldMap = fieldsToMap(this.keyFields.join(','), null, this.topLevelFieldMap);
    let processed = 0;
    while (params) {
      const result = await this.scanAllByParams(params, fieldMap);
      processed += await this.deleteByKeys(result.items);
      params = result.nextParams;
    }
    return processed;
  }

  async genericDeleteByKeys(keys) {
    await Promise.all(keys.map(key => this.deleteByKey(key)));
    return keys.length;
  }

  async genericCloneAllByParams(params, mapFn) {
    params = this.cloneParams(params);
    let processed = 0;
    while (params) {
      const result = await this.scanAllByParams(params);
      processed += await this.cloneByKeys(result.items, mapFn);
      params = result.nextParams;
    }
    return processed;
  }

  async genericCloneByKeys(keys, mapFn) {
    await Promise.all(keys.map(key => this.cloneByKey(key, mapFn, true)));
    return keys.length;
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

  fromDynamo(item, fieldMap) {
    return this.revive(convertFrom(item), fieldMap);
  }

  toDynamo(item) {
    return convertTo(this.prepare(item), this.specialTypes);
  }

  toDynamoKey(item, index) {
    return convertTo(this.prepareKey(item, index), this.specialTypes);
  }

  async validateItems(items, isPatch, deep) {
    for (let i = 0; i < items.length; ++i) {
      await this.validateItem(items[i], isPatch, deep);
    }
  }

  // batch operations

  makeGetBatch(keys, params) {
    const batch = {
      action: 'get',
      table: this.table,
      adapter: this,
      keys: keys.map(key => this.toDynamoKey(key)),
      params
    };
    return batch;
  }

  makeDeleteBatch(keys, params) {
    return {
      action: 'delete',
      table: this.table,
      keys: keys.map(key => this.toDynamoKey(key)),
      params
    };
  }

  makePutBatch(items, params) {
    return {
      action: 'put',
      table: this.table,
      items: items.map(item => this.toDynamo(item)),
      params
    };
  }

  makePatchBatch(items, deep, params) {
    return {
      action: 'patch',
      table: this.table,
      items: items.map(item => {
        const dbItem = convertTo(this.prepare(item, true, deep), this.specialTypes);
        this.keyFields.forEach(field => delete dbItem[field]);
        let p;
        if (deep) {
          p = prepareUpdate(dbItem);
        } else {
          const deleteProps = item.__delete;
          delete dbItem.__delete;
          p = prepareUpdate.flat(dbItem, deleteProps);
        }
        return {
          key: this.toDynamoKey(item),
          params: p
        };
      }),
      params
    };
  }

  makeCheckBatch(keys, params) {
    return {
      action: 'check',
      table: this.table,
      keys: keys.map(key => this.toDynamoKey(key)),
      params
    };
  }

  makeGetRawBatch(rawKeys, params) {
    const batch = {
      action: 'get',
      table: this.table,
      adapter: this,
      keys: rawKeys,
      params
    };
    return batch;
  }

  makeDeleteRawBatch(rawKeys, params) {
    return {
      action: 'delete',
      table: this.table,
      keys: rawKeys,
      params
    };
  }

  makePutRawBatch(rawItems, params) {
    return {
      action: 'put',
      table: this.table,
      items: rawItems,
      params
    };
  }

  makePatchRawBatch(rawItems, deep, params) {
    return {
      action: 'patch',
      table: this.table,
      items: rawItems,
      params
    };
  }

  makeCheckRawBatch(rawKeys, params) {
    return {
      action: 'check',
      table: this.table,
      keys: rawKeys,
      params
    };
  }
}

Adapter.adapt = Adapter.make;

module.exports = Adapter;
