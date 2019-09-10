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
    const fieldMap = fieldsToMap(fields);
    fieldMap && addProjection(params, fieldMap, this.projectionFieldMap, true);
    const data = await this.client.getItem(cleanParams(params)).promise();
    return data.Item ? this.fromDynamo(data.Item, fieldMap) : undefined;
  }

  async get(item, fields, params) {
    return this.getByKey(item, fields, params);
  }

  async post(item) {
    await this.validateItem(item);
    const params = {
      TableName: this.table,
      ConditionExpression: 'attribute_not_exists(#k)',
      ExpressionAttributeNames: {'#k': this.keyFields[0]},
      Item: this.toDynamo(item)
    };
    return this.client.putItem(cleanParams(params)).promise();
  }

  async put(item, force, params) {
    await this.validateItem(item);
    params = this.cloneParams(params);
    if (!force) {
      const keyName = '#k' + Object.keys(params.ExpressionAttributeNames).length;
      if (params.ConditionExpression) {
        params.ConditionExpression = `attribute_exists(${keyName}) AND (${params.ConditionExpression})`;
      } else {
        params.ConditionExpression = `attribute_exists(${keyName})`;
      }
      params.ExpressionAttributeNames[keyName] = this.keyFields[0];
    }
    params.Item = this.toDynamo(item);
    params = this.updateParams(params, {name: 'put', force});
    params = cleanParams(params);
    return this.client.putItem(params).promise();
  }

  async patchByKey(key, item, deep, params) {
    await this.validateItem(item, true, deep);
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    const keyName = '#k' + Object.keys(params.ExpressionAttributeNames).length;
    if (params.ConditionExpression) {
      params.ConditionExpression = `attribute_exists(${keyName}) AND (${params.ConditionExpression})`;
    } else {
      params.ConditionExpression = `attribute_exists(${keyName})`;
    }
    params.ExpressionAttributeNames[keyName] = this.keyFields[0];
    const dbItem = convertTo(this.prepare(item, true, deep), this.specialTypes);
    this.keyFields.forEach(field => delete dbItem[field]);
    if (deep) {
      params = prepareUpdate(dbItem, params);
    } else {
      const deleteProps = item.__delete;
      delete dbItem.__delete;
      params = prepareUpdate.flat(dbItem, deleteProps, params);
    }
    params = this.updateParams(params, {name: 'patch', deep});
    params = cleanParams(params);
    return params.UpdateExpression ? this.client.updateItem(params).promise() : null;
  }

  async patch(item, deep, params) {
    return this.patchByKey(item, item, deep, params);
  }

  async deleteByKey(key, params) {
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    params = this.updateParams(params, {name: 'delete'});
    params = cleanParams(params);
    return this.client.deleteItem(params).promise();
  }

  async delete(item, params) {
    return this.deleteByKey(item, params);
  }

  async cloneByKey(key, mapFn, force, params) {
    params = this.cloneParams(params);
    params.Key = this.toDynamoKey(key, params.IndexName);
    const data = await this.client.getItem(cleanParams(params)).promise();
    if (!data.Item) return false;
    delete params.Key;
    if (!force) {
      params.ExpressionAttributeNames = params.ExpressionAttributeNames || {};
      const keyName = '#k' + Object.keys(params.ExpressionAttributeNames).length;
      if (params.ConditionExpression) {
        params.ConditionExpression = `attribute_not_exists(${keyName}) AND (${params.ConditionExpression})`;
      } else {
        params.ConditionExpression = `attribute_not_exists(${keyName})`;
      }
      params.ExpressionAttributeNames[keyName] = this.keyFields[0];
    }
    params.Item = this.toDynamo(mapFn(this.revive(convertFrom(data.Item))));
    await this.client.putItem(params).promise();
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
    const fieldMap = fieldsToMap(options.fields);
    project && fieldMap && addProjection(params, fieldMap, this.projectionFieldMap, skipSelect);
    return filtering(options.filter, fieldMap, this.searchable, this.searchablePrefix, params);
  }

  async getAllByParams(params, options, fields) {
    params = this.cloneParams(params);
    const result = await paginateList(this.client, params, options);
    const fieldMap = fieldsToMap(fields);
    result.data = result.data.map(item => this.fromDynamo(item, fieldMap));
    return result;
  }

  async getByKeys(keys, fields, params) {
    params = this.cloneParams(params);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const items = await readList.byKeys(this.client, this.table, keys.map(key => this.toDynamoKey(key, params.IndexName)), params);
    const fieldMap = fieldsToMap(fields);
    return items.map(item => this.fromDynamo(item, fieldMap));
  }

  async getAll(options, item, index) {
    const params = this.makeParams(options, true, this.prepareListParams(item, index));
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
    return await deleteList.byKeys(this.client, this.table, keys.map(key => this.toDynamoKey(key)));
  }

  async deleteAll(options, item, index) {
    const params = this.makeParams(options, false, this.prepareListParams(item, index));
    return this.deleteAllByParams(params);
  }

  async cloneAllByParams(params, mapFn) {
    params = this.cloneParams(params);
    return copyList(this.client, params, item => this.toDynamo(mapFn(this.fromDynamo(item))));
  }

  async cloneByKeys(keys, mapFn) {
    return await copyList.byKeys(this.client, this.table, keys.map(key => this.toDynamoKey(key)), item => this.toDynamo(mapFn(this.fromDynamo(item))));
  }

  async cloneAll(options, mapFn, item, index) {
    const params = this.makeParams(options, false, this.prepareListParams(item, index));
    return this.cloneAllByParams(params, mapFn);
  }

  // utilities

  cloneParams(params) {
    params = cloneParams(params);
    params.TableName = this.table;
    return params;
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
}

Adapter.adapt = Adapter.make;

module.exports = Adapter;
