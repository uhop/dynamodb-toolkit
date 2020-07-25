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

  augmentItemFromContext(item, ctx) {
    // this function can override keys taking them from the context (params, query)
    return Object.assign(item, ctx.params);
  }

  augmentCloneFromContext(ctx) {
    return item => ({...item, ...ctx.request.body});
  }

  extractKeys(ctx, forceQuery) {
    // this function creates an array of keys from the context (e.g., params.names)
    let names;
    if (!forceQuery && (ctx.method === 'PUT' || ctx.method === 'POST')) {
      if (!ctx.request.body || !(ctx.request.body instanceof Array)) throw new Error('Array of names was expected as a payload.');
      names = ctx.request.body;
    } else {
      if (!ctx.query.names) throw new Error('Query parameter "names" was expected. Should be a comma-separated list of names.');
      names = ctx.query.names
        .split(',')
        .map(name => name.trim())
        .filter(name => name);
    }
    return this.namesToKeys(ctx, names);
  }

  namesToKeys(ctx, names) {
    // this function converts names to keys
    return names.map(name => ({name}));
  }

  // main operations

  async get(ctx) {
    const params = this.adapter.makeParams({consistent: isConsistent(ctx.query)}),
      item = await this.adapter.getByKey(this.augmentItemFromContext({}, ctx), ctx.query.fields, params);
    if (typeof item !== 'undefined') {
      ctx.body = item;
    } else {
      ctx.status = 404;
    }
  }

  async post(ctx) {
    const item = this.augmentItemFromContext(ctx.request.body, ctx);
    await this.adapter.post(item);
    ctx.status = 204;
  }

  async put(ctx) {
    const item = this.augmentItemFromContext(ctx.request.body, ctx);
    await this.adapter.put(item, isTrue(ctx.query, 'force'));
    ctx.status = 204;
  }

  async patch(ctx) {
    const item = this.augmentItemFromContext(ctx.request.body, ctx);
    await this.adapter.patch(item);
    ctx.status = 204;
  }

  async delete(ctx) {
    await this.adapter.deleteByKey(this.augmentItemFromContext({}, ctx));
    ctx.status = 204;
  }

  async doClone(ctx, mapFn) {
    const done = await this.adapter.cloneByKey(this.augmentItemFromContext({}, ctx), mapFn, isTrue(ctx.query, 'force'));
    ctx.status = done ? 204 : 404;
  }

  async clone(ctx) {
    return this.doClone(ctx, this.augmentCloneFromContext(ctx));
  }

  async doMove(ctx, mapFn) {
    const done = await this.adapter.moveByKey(this.augmentItemFromContext({}, ctx), mapFn, isTrue(ctx.query, 'force'));
    ctx.status = done ? 204 : 404;
  }

  async move(ctx) {
    return this.doMove(ctx, this.augmentCloneFromContext(ctx));
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
    ctx.body = await this.adapter.getAll(this.makeOptions(ctx), this.augmentItemFromContext({}, ctx));
  }

  async getByNames(ctx) {
    ctx.body = await this.adapter.getByKeys(this.extractKeys(ctx), ctx.query.fields, isConsistent(ctx.query) ? {ConsistentRead: true} : null);
  }

  async deleteAll(ctx) {
    ctx.body = {processed: await this.adapter.deleteAll(this.makeOptions(ctx), this.augmentItemFromContext({}, ctx))};
  }

  async deleteByNames(ctx) {
    ctx.body = {processed: await this.adapter.deleteByKeys(this.extractKeys(ctx))};
  }

  async doCloneAll(ctx, mapFn) {
    ctx.body = {processed: await this.adapter.cloneAll(this.makeOptions(ctx), mapFn, this.augmentItemFromContext({}, ctx))};
  }

  async cloneAll(ctx) {
    return this.doCloneAll(ctx, this.augmentCloneFromContext(ctx));
  }

  async doCloneByNames(ctx, mapFn) {
    ctx.body = {processed: await this.adapter.cloneByKeys(this.extractKeys(ctx, true), mapFn)};
  }

  async cloneByNames(ctx) {
    return this.doCloneByNames(ctx, this.augmentCloneFromContext(ctx));
  }

  async doMoveAll(ctx, mapFn) {
    ctx.body = {processed: await this.adapter.moveAll(this.makeOptions(ctx), mapFn, this.augmentItemFromContext({}, ctx))};
  }

  async moveAll(ctx) {
    return this.doMoveAll(ctx, this.augmentCloneFromContext(ctx));
  }

  async doMoveByNames(ctx, mapFn) {
    ctx.body = {processed: await this.adapter.moveByKeys(this.extractKeys(ctx, true), mapFn)};
  }

  async moveByNames(ctx) {
    return this.doCloneByNames(ctx, this.augmentCloneFromContext(ctx));
  }
}

KoaAdapter.adapt = KoaAdapter.make;

module.exports = KoaAdapter;
