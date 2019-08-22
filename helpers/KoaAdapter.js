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
    return Object.assign(item, ctx.params);
  }

  // main operations

  async get(ctx) {
    const params = this.adapter.makeParams({consistent: isConsistent(ctx.query)}),
      item = await this.adapter.getByKey(this.augmentFromContext({}, ctx), ctx.query.fields, params);
    if (typeof item !== 'undefined') {
      ctx.body = item;
    } else {
      ctx.status = 404;
    }
  }

  async post(ctx) {
    const item = this.augmentFromContext(ctx.request.body, ctx);
    await this.adapter.post(item);
    ctx.status = 204;
  }

  async put(ctx) {
    const item = this.augmentFromContext(ctx.request.body, ctx);
    await this.adapter.put(item, isTrue(ctx.query, 'force'));
    ctx.status = 204;
  }

  async patch(ctx) {
    const item = this.augmentFromContext(ctx.request.body, ctx);
    await this.adapter.patch(item, isTrue(ctx.query, 'deep'));
    ctx.status = 204;
  }

  async delete(ctx) {
    await this.adapter.deleteByKey(this.augmentFromContext({}, ctx));
    ctx.status = 204;
  }

  async clone(ctx) {
    const done = await this.adapter.cloneByKey(this.augmentFromContext({}, ctx), item => ({...item, name: item.name + ' COPY'}));
    ctx.status = done ? 204 : 404;
  }

  // mass operations

  makeOptions(ctx) {
    return {
      consistent: isConsistent(ctx.query),
      filter: ctx.query.filter,
      fields: ctx.query.fields
    };
  }

  makeParams(ctx, project, params) {
    return this.adapter.makeParams(this.makeOptions(ctx), project, params);
  }

  async getAll(ctx) {
    ctx.body = await this.adapter.getAll(this.makeOptions(ctx), Object.assign({}, ctx.params));
  }

  async deleteAll(ctx) {
    ctx.body = {processed: await this.adapter.deleteAll(this.makeOptions(ctx), Object.assign({}, ctx.params))};
  }

  async doCloneAll(ctx, mapFn) {
    ctx.body = {processed: await this.adapter.cloneAll(this.makeOptions(ctx), mapFn, Object.assign({}, ctx.params))};
  }
}

KoaAdapter.adapt = KoaAdapter.make;

module.exports = KoaAdapter;
