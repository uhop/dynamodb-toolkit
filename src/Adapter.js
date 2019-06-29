'use strict';

const addProjection = require('./addProjection');
const {convertTo, convertFrom} = require('./convertTypes');
const prepareUpdate = require('./prepareUpdate');

class Adapter {
  constructor(options) {
    // defaults
    this.keyFields = [];
    this.specialTypes = {};
    this.prepareMap = {};
    // overlay
    Object.assign(this, options);
  }

  // user-defined methods

  // makeKey(item) {...} should be provided
  prepare(item) {
    return item;
  }
  revive(item, fields) {
    return item;
  }

  // general API

  async getByKey(key, fields, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    params.Key = key;
    fields && addProjection(params, fields, this.prepareMap, true);
    const data = await this.client.getItem(params).promise();
    return data.Item ? this.revive(convertFrom(data.Item), fields) : undefined;
  }
  async get(item, fields, params) {
    return this.getByKey(this.makeKey(item), fields, params);
  }
  async post(item, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    if (params.ConditionExpression) {
      params.ConditionExpression = `attribute_not_exists(${this.keyFields[0]}) AND (${params.ConditionExpression})`;
    } else {
      params.ConditionExpression = `attribute_not_exists(${this.keyFields[0]})`;
    }
    params.Item = convertTo(this.prepare(item), this.specialTypes);
    return this.client.putItem(params).promise();
  }
  async put(item, params, force) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    if (!force) {
      if (params.ConditionExpression) {
        params.ConditionExpression = `attribute_exists(${this.keyFields[0]}) AND (${params.ConditionExpression})`;
      } else {
        params.ConditionExpression = `attribute_exists(${this.keyFields[0]})`;
      }
    }
    params.Item = convertTo(this.prepare(item), this.specialTypes);
    return this.client.putItem(params).promise();
  }
  async patchByKey(key, item, deep, params) {
    params = params ? Object.assign({}, params) : {};
    params.TableName = this.table;
    params.Key = key;
    if (params.ConditionExpression) {
      params.ConditionExpression = `attribute_exists(${this.keyFields[0]}) AND (${params.ConditionExpression})`;
    } else {
      params.ConditionExpression = `attribute_exists(${this.keyFields[0]})`;
    }
    item = convertTo(this.prepare(item), this.specialTypes);
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
    params.Key = key;
    return this.client.deleteItem(params).promise();
  }
  async delete(item, params) {
    return this.deleteByKey(this.makeKey(item), params);
  }
}
