const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const Router = require('koa-router');

const AWS = require('aws-sdk');

const Adapter = require('../Adapter');
const KoaAdapter = require('../helpers/KoaAdapter');

AWS.config.update({region: 'us-east-1'});

const client = new AWS.DynamoDB();

const adapter = new Adapter({
  client,
  table: 'test',
  keyFields: ['name'],
  searchable: {name: 1, climate: 1, terrain: 1},
  prepare(item) {
    const data = Object.keys(item).reduce((acc, key) => {
      if (key.charAt(0) !== '-') {
        acc[key] = item[key];
        if (this.searchable[key] === 1) acc['-search-' + key] = (item[key] + '').toLowerCase();
      }
      return acc;
    }, {});
    data['-t'] = 1;
    return data;
  },
  prepareListParams(_, index) {
    return index
      ? {
          IndexName: index,
          KeyConditionExpression: '#t = :t',
          ExpressionAttributeNames: {'#t': '-t'},
          ExpressionAttributeValues: {':t': {N: '1'}}
        }
      : {};
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
  augmentFromContext(item, ctx) {
    if (ctx.params.planet) {
      item.name = ctx.params.planet;
    }
    return item;
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
  // use standard deleteAll()
  async cloneAll(ctx) {
    return this.doCloneAll(ctx, item => ({...item, name: item.name + ' COPY'}));
  },
  async load(ctx) {
    // const data = JSON.parse(await fs.promises.readFile(path.join(__dirname, 'data.json')));
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'data.json.gz'))));
    await this.adapter.putAll(data);
    ctx.body = {processed: data.length};
  },
  async getByNames(ctx) {
    if (!ctx.query.names) throw new Error('Query parameter "names" was expected. Should be a comma-separated list of planet names.');
    const params = this.makeParams(ctx);
    ctx.body = await this.adapter.getAllByKeys(
      ctx.query.names
        .split(',')
        .map(name => name.trim())
        .filter(name => name)
        .map(name => ({name})),
      ctx.query.fields,
      params
    );
  }
});

const router = new Router();

router
  // mass operations
  .get('/', async ctx => koaAdapter.getAll(ctx))
  .put('/-load', async ctx => koaAdapter.load(ctx))
  .put('/-delete-all', async ctx => koaAdapter.deleteAll(ctx))
  .put('/-clone-all', async ctx => koaAdapter.cloneAll(ctx))
  .get('/-get-by-names', async ctx => koaAdapter.getByNames(ctx))

  // item operations
  .post('/', async ctx => koaAdapter.post(ctx))
  .get('/:planet', async ctx => koaAdapter.get(ctx))
  .put('/:planet', async ctx => koaAdapter.put(ctx))
  .patch('/:planet', async ctx => koaAdapter.patch(ctx))
  .delete('/:planet', async ctx => koaAdapter.delete(ctx))
  .put('/:planet/-clone', async ctx => koaAdapter.clone(ctx));

module.exports = router;
