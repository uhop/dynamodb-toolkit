'use strict';

const Adapter = require('../Adapter');
const {isTrue, isConsistent} = require('./isTrue');

class KoaAdapter {
  constructor(adapter, overlay) {
    this.adapter = adapter instanceof Adapter ? adapter : new Adapter(adapter);
    Object.assign(this, overlay);
  }

  static make(adapter, overlay) {
    return new KoaAdapter(adapter, overlay);
  }

  // user-provided

  augmentFromContext(item, ctx) {
    // this function can override keys taking them from the context (params, query)
    return item;
  }

  async validItem(item) {
    // this function should throw an exception if an item is incorrect for some reason
  }

  async canBeModified(item) {
    // this function should throw an exception if an item cannot be modified
  }

  // main operations

  async get(ctx) {
    const params = {};
    if (isConsistent(ctx.query)) {
      params.ConsistentRead = true;
    }
    const item = await this.adapter.get(this.augmentFromContext({}, ctx), ctx.query.fields, params);
    if (typeof item !== 'undefined') {
      ctx.body = item;
    } else {
      ctx.status = 404;
    }
  }

  async post(ctx) {
    const item = this.augmentFromContext(ctx.request.body, ctx);
    await this.validItem(item);
    await this.canBeModified(item);
    await this.adapter.post(item);
    ctx.status = 204;
  }

  async put(ctx) {
    const item = this.augmentFromContext(ctx.request.body, ctx);
    await this.validItem(item);
    await this.canBeModified(item);
    await this.adapter.put(item, isTrue(ctx.query, 'force'));
    ctx.status = 204;
  }

  async patch(ctx) {
    const item = this.augmentFromContext(ctx.request.body, ctx);
    await this.canBeModified(item);
    await this.adapter.patch(item, isTrue(ctx.query, 'deep'));
    ctx.status = 204;
  }

  async delete(ctx) {
    await this.adapter.delete(this.augmentFromContext({}, ctx));
    ctx.status = 204;
  }

  // mass operations

  massParams(ctx, params) {
    return this.adapter.massParams({
      consistent: isConsistent(ctx.query),
      filter: ctx.query.filter,
      fields: ctx.query.fields
    }, params);
  }
}

KoaAdapter.adapt = KoaAdapter.make;

module.exports = KoaAdapter;
