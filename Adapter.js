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

class Adapter {
  constructor(options) {
    // defaults
    this.keyFields = [];
    this.specialTypes = {_delete: 'SS'};
    this.projectionFieldMap = {};
    // overlay
    Object.assign(this, options);
  }

  static make(options) {
    return new Adapter(options);
  }

  // user-defined methods

  prepare(item, isPatch) {
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

  revive(item, fieldMap) {
    // reconstitute a database object
    // remove some technical fields if required
    return item;
  }

  // general API

  async getByKey(key, fields, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    params.Key = convertTo(this.prepareKey(key, params.IndexName), this.specialTypes);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const data = await this.client.getItem(params).promise();
    return data.Item ? this.revive(convertFrom(data.Item), fieldsToMap(fields)) : undefined;
  }

  async get(item, fields, params) {
    return this.getByKey(item, fields, params);
  }

  async post(item, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    if (params.ConditionExpression) {
      params.ConditionExpression = `attribute_not_exists(#k) AND (${params.ConditionExpression})`;
    } else {
      params.ConditionExpression = 'attribute_not_exists(#k)';
    }
    params.ExpressionAttributeNames = Object.assign({}, params.ExpressionAttributeNames) || {};
    params.ExpressionAttributeNames['#k'] = this.keyFields[0];
    params.Item = convertTo(this.prepare(item), this.specialTypes);
    return this.client.putItem(params).promise();
  }

  async put(item, force, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    if (!force) {
      if (params.ConditionExpression) {
        params.ConditionExpression = `attribute_exists(#k) AND (${params.ConditionExpression})`;
      } else {
        params.ConditionExpression = 'attribute_exists(#k)';
      }
      params.ExpressionAttributeNames = Object.assign({}, params.ExpressionAttributeNames) || {};
      params.ExpressionAttributeNames['#k'] = this.keyFields[0];
    }
    params.Item = convertTo(this.prepare(item), this.specialTypes);
    return this.client.putItem(params).promise();
  }

  async patchByKey(key, item, deep, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    params.Key = convertTo(this.prepareKey(key, params.IndexName), this.specialTypes);
    if (params.ConditionExpression) {
      params.ConditionExpression = `attribute_exists(#k) AND (${params.ConditionExpression})`;
    } else {
      params.ConditionExpression = 'attribute_exists(#k)';
    }
    params.ExpressionAttributeNames = Object.assign({}, params.ExpressionAttributeNames) || {};
    params.ExpressionAttributeNames['#k'] = this.keyFields[0];
    const dbItem = convertTo(this.prepare(item, true), this.specialTypes);
    this.keyFields.forEach(field => delete dbItem[field]);
    if (deep) {
      params = prepareUpdate(dbItem, params);
    } else {
      const deleteProps = item.__delete;
      if (dbItem.__delete) {
        delete dbItem.__delete;
      }
      params = prepareUpdate.flat(dbItem, deleteProps, params);
    }
    return params.UpdateExpression ? this.client.updateItem(params).promise() : null;
  }

  async patch(item, deep, params) {
    return this.patchByKey(item, item, deep, params);
  }

  async deleteByKey(key, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    params.Key = convertTo(this.prepareKey(key, params.IndexName), this.specialTypes);
    return this.client.deleteItem(params).promise();
  }

  async delete(item, params) {
    return this.deleteByKey(item, params);
  }

  async cloneByKey(key, mapFn, force, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    params.Key = convertTo(this.prepareKey(key, params.IndexName), this.specialTypes);
    const data = await this.client.getItem(params).promise();
    if (!data.Item) return false;
    delete params.Key;
    params.Item = convertTo(this.prepare(mapFn(this.revive(convertFrom(data.Item)))), this.specialTypes);
    if (!force) {
      if (params.ConditionExpression) {
        params.ConditionExpression = `attribute_exists(#k) AND (${params.ConditionExpression})`;
      } else {
        params.ConditionExpression = 'attribute_exists(#k)';
      }
      params.ExpressionAttributeNames = Object.assign({}, params.ExpressionAttributeNames) || {};
      params.ExpressionAttributeNames['#k'] = this.keyFields[0];
    }
    await this.client.putItem(params).promise();
    return true;
  }

  async clone(item, mapFn, force, params) {
    return this.cloneByKey(item, mapFn, force, params);
  }

  // mass operations

  async getAllByParams(params, options, fields) {
    params = Object.assign({}, params);
    params.TableName = this.table;
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const result = await paginateList(this.client, params, options),
      fieldMap = fieldsToMap(fields);
    result.data = result.data.map(item => this.revive(convertFrom(item), fieldMap));
    return result;
  }

  async getAllByKeys(keys, fields, params) {
    params = Object.assign({}, params);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const items = await readList(this.client, this.table, keys.map(key => convertTo(this.prepareKey(key, params.IndexName), this.specialTypes)), params),
      fieldMap = fieldsToMap(fields);
    return items.map(item => this.revive(convertFrom(item), fieldMap));
  }

  async putAll(items) {
    return writeList(this.client, this.table, items, item => convertTo(this.prepare(item), this.specialTypes));
  }

  async deleteAllByParams(params) {
    params = Object.assign({}, params);
    params.TableName = this.table;
    params.ExpressionAttributeNames = params.ExpressionAttributeNames ? Object.assign({}, params.ExpressionAttributeNames) : {};
    const keys = this.keyFields.map((key, index) => {
      const keyName = '#k' + index;
      params.ExpressionAttributeNames[keyName] = key;
      return keyName;
    });
    params.ProjectionExpression = keys.join(',');
    params.Select = 'SPECIFIC_ATTRIBUTES';
    return deleteList(this.client, params);
  }

  async cloneAllByParams(params, mapFn) {
    params = Object.assign({}, params);
    params.TableName = this.table;
    return copyList(this.client, params, item => convertTo(this.prepare(mapFn(this.revive(convertFrom(item)))), this.specialTypes));
  }
}

Adapter.adapt = Adapter.make;

module.exports = Adapter;
