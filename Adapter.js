'use strict';

const addProjection = require('./utils/addProjection');
const {convertTo, convertFrom} = require('./utils/convertTypes');
const prepareUpdate = require('./utils/prepareUpdate');
const paginateList = require('./utils/paginateList');
const deleteList = require('./utils/deleteList');
const copyList = require('./utils/copyList');
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

  // makeKey(item) {...} should be provided
  prepare(item) {
    // prepare to write it to a database
    // add some technical fields if required
    return item;
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
    params.Key = convertTo(key);
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const data = await this.client.getItem(params).promise();
    return data.Item ? this.revive(convertFrom(data.Item), fieldsToMap(fields)) : undefined;
  }

  async get(item, fields, params) {
    return this.getByKey(this.makeKey(item), fields, params);
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

  async put(item, params, force) {
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
    params.Key = convertTo(key);
    if (params.ConditionExpression) {
      params.ConditionExpression = `attribute_exists(#k) AND (${params.ConditionExpression})`;
    } else {
      params.ConditionExpression = 'attribute_exists(#k)';
    }
    params.ExpressionAttributeNames = Object.assign({}, params.ExpressionAttributeNames) || {};
    params.ExpressionAttributeNames['#k'] = this.keyFields[0];
    item = convertTo(this.prepare(item, true), this.specialTypes);
    this.keyFields.forEach(field => delete item[field]);
    params = deep ? prepareUpdate(item, params) : prepareUpdate.flat(item, params);
    return params.UpdateExpression ? this.client.updateItem(params).promise() : null;
  }

  async patch(item, deep, params) {
    return this.patchByKey(this.makeKey(item), item, deep, params);
  }

  async deleteByKey(key, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    params.Key = convertTo(key);
    return this.client.deleteItem(params).promise();
  }

  async delete(item, params) {
    return this.deleteByKey(this.makeKey(item), params);
  }

  async cloneByKey(key, mapFn, params, force) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    params.Key = convertTo(key);
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

  async clone(item, mapFn, params, force) {
    return this.cloneByKey(this.makeKey(item), mapFn, params, force);
  }

  // mass operations

  async getAllByParams(params, action, options, fields) {
    params = Object.assign({}, params);
    params.TableName = this.table;
    fields && addProjection(params, fields, this.projectionFieldMap, true);
    const result = await paginateList(this.client, action, params, options),
      fieldMap = fieldsToMap(fields);
    result.data = result.data.map(item => this.revive(convertFrom(item), fieldMap));
    return result;
  }

  async putAll(items) {
    return writeList(this.client, this.table, items, item => convertTo(this.prepare(item), this.specialTypes));
  }

  async deleteAllByParams(params, action) {
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
    return deleteList(this.client, action, params);
  }

  async cloneAllByParams(params, action, mapFn) {
    params = Object.assign({}, params);
    params.TableName = this.table;
    return copyList(this.client, action, params, item => convertTo(this.prepare(mapFn(this.revive(convertFrom(item)))), this.specialTypes));
  }
}

Adapter.adapt = Adapter.make;

module.exports = Adapter;
