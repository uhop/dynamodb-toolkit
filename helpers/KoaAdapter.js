'use strict';

const Adapter = require('../Adapter');
const {isTrue, isConsistent} = require('./isTrue');

const cloneFn = ctx => item => Object.assign({}, item, ctx.request.body);

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

  async doClone(ctx, mapFn) {
    const done = await this.adapter.cloneByKey(this.augmentFromContext({}, ctx), mapFn, isTrue(ctx.query, 'force'));
    ctx.status = done ? 204 : 404;
  }

  async clone(ctx) {
    return this.doClone(ctx, cloneFn(ctx));
  }

  // mass operations

  makeOptions(ctx) {
    return {
      consistent: isConsistent(ctx.query),
      filter: ctx.query.filter,
      fields: ctx.query.fields,
      offset: ctx.query.offset,
      limit: ctx.query.limit
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

  async cloneAll(ctx) {
    return this.doCloneAll(ctx, cloneFn(ctx));
  }
}

KoaAdapter.adapt = KoaAdapter.make;

module.exports = KoaAdapter;
