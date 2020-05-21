const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const Router = require('koa-router');

const AWS = require('aws-sdk');

const Adapter = require('../Adapter');
const KoaAdapter = require('../helpers/KoaAdapter');
const createClient = require('../utils/createClient');

const client = createClient(AWS);

const adapter = new Adapter({
  client,
  table: 'test',
  keyFields: ['name'],
  searchable: {name: 1, climate: 1, terrain: 1},
  prepare(item, isPatch) {
    const data = Object.keys(item).reduce((acc, key) => {
      if (key.charAt(0) !== '-') {
        acc[key] = item[key];
        if (this.searchable[key] === 1) acc['-search-' + key] = (item[key] + '').toLowerCase();
      }
      return acc;
    }, {});
    if (isPatch) {
      delete data.name; // removes the key field
    } else {
      data['-t'] = 1;
    }
    return data;
  },
  prepareKey(item, index) {
    const key = {name: item.name};
    if (index) {
      key.IndexName = index;
      key['-t'] = 1;
    }
    return key;
  },
  prepareListParams(_, index) {
    index = index || '-t-name-index';
    return {
      IndexName: index,
      KeyConditionExpression: '#t = :t',
      ExpressionAttributeNames: {'#t': '-t'},
      ExpressionAttributeValues: {':t': {N: '1'}}
    };
  },
  revive(item, fieldMap) {
    if (fieldMap) {
      return Object.keys(item).reduce((acc, key) => {
        if (fieldMap[key] === 1) {
          acc[key] = item[key];
        }
        return acc;
      }, {});
    }
    return Object.keys(item).reduce((acc, key) => {
      if (key.charAt(0) !== '-') {
        acc[key] = item[key];
      }
      return acc;
    }, {});
  }
});

const koaAdapter = new KoaAdapter(adapter, {
  sortableIndices: {name: '-t-name-index'},
  augmentItemFromContext(item, ctx) {
    if (ctx.params.planet) {
      item.name = ctx.params.planet;
    }
    return item;
  },
  augmentCloneFromContext(ctx) {
    return item => ({...item, name: item.name + ' COPY'});
  },
  async getAll(ctx) {
    let index, descending;
    if (ctx.query.sort) {
      let sortName = ctx.query.sort;
      descending = ctx.query.sort.charAt(0) == '-';
      descending && (sortName = ctx.query.sort.substr(1));
      index = this.sortableIndices[sortName];
    }
    const options = this.makeOptions(ctx);
    descending && (options.descending = true);
    ctx.body = await this.adapter.getAll(options, null, index);
  },
  async load(ctx) {
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'data.json.gz'))));
    await this.adapter.putAll(data);
    ctx.body = {processed: data.length};
  }
});

const router = new Router();

router
  // mass operations
  .get('/', async ctx => koaAdapter.getAll(ctx))
  .delete('/', async ctx => koaAdapter.deleteAll(ctx))
  .put('/-load', async ctx => koaAdapter.load(ctx))
  .put('/-clone', async ctx => koaAdapter.cloneAll(ctx))
  .put('/-clone-by-names', async ctx => koaAdapter.cloneByNames(ctx))
  .get('/-by-names', async ctx => koaAdapter.getByNames(ctx))
  .delete('/-by-names', async ctx => koaAdapter.deleteByNames(ctx))

  // item operations
  .post('/', async ctx => koaAdapter.post(ctx))
  .get('/:planet', async ctx => koaAdapter.get(ctx))
  .put('/:planet', async ctx => koaAdapter.put(ctx))
  .patch('/:planet', async ctx => koaAdapter.patch(ctx))
  .delete('/:planet', async ctx => koaAdapter.delete(ctx))
  .put('/:planet/-clone', async ctx => koaAdapter.clone(ctx));

module.exports = router;
