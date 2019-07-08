const fs = require('fs');
const path = require('path');

const Router = require('koa-router');

const AWS = require('aws-sdk');

const Adapter = require('../Adapter');
const KoaAdapter = require('../helpers/KoaAdapter');

AWS.config.update({region: 'us-east-1'});

const client = new AWS.DynamoDB();

const adapter = new KoaAdapter(
  new Adapter({
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
  }),
  {
    sortableIndices: {name: '-t-name-index'},
    augmentFromContext(item, ctx) {
      if (ctx.params.planet) {
        item.name = ctx.params.planet;
      }
      return item;
    },
    async getAll(ctx) {
      let params = {};
      if (ctx.query.sort) {
        let sortName = ctx.query.sort,
          descending = ctx.query.sort.charAt(0) == '-';
        if (descending) {
          sortName = ctx.query.sort.substr(1);
        }
        const index = this.sortableIndices[sortName];
        if (index) {
          if (descending) {
            params.ScanIndexForward = false;
            params.KeyConditionExpression = '#t = :t';
            params.ExpressionAttributeNames = {'#t': '-t'};
            params.ExpressionAttributeValues = {':t': {N: '1'}};
          }
          params.IndexName = index;
        }
      }
      params = this.massParams(ctx, params);
      ctx.body = await this.adapter.getAllByParams(params, {offset: ctx.query.offset, limit: ctx.query.limit}, ctx.query.fields);
    },
    async deleteAll(ctx) {
      const params = this.massParams(ctx);
      ctx.body = {processed: await this.adapter.deleteAllByParams(params)};
    },
    async cloneAll(ctx) {
      const params = this.massParams(ctx);
      ctx.body = {processed: await this.adapter.cloneAllByParams(params, item => ({...item, name: item.name + ' COPY'}))};
    },
    async load(ctx) {
      const data = JSON.parse(await fs.promises.readFile(path.join(__dirname, 'data.json')));
      await this.adapter.putAll(data);
      ctx.status = 204;
    },
    async getByNames(ctx) {
      if (!ctx.query.names) throw new Error('Query parameter "names" was expected. Should be a comma-separated list of planet names.');
      const params = this.massParams(ctx);
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
  }
);

const router = new Router();

router
  // mass operations
  .get('/', async ctx => adapter.getAll(ctx))
  .put('/-load', async ctx => adapter.load(ctx))
  .put('/-delete-all', async ctx => adapter.deleteAll(ctx))
  .put('/-clone-all', async ctx => adapter.cloneAll(ctx))
  .get('/-get-by-names', async ctx => adapter.getByNames(ctx))

  // item operations
  .post('/', async ctx => adapter.post(ctx))
  .get('/:planet', async ctx => adapter.get(ctx))
  .put('/:planet', async ctx => adapter.put(ctx))
  .patch('/:planet', async ctx => adapter.patch(ctx))
  .delete('/:planet', async ctx => adapter.delete(ctx));

module.exports = router;
