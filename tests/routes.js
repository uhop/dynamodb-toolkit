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
    makeKey(item) {
      return {name: item.name};
    },
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
      let params = {},
        action = 'scan';
      if (ctx.query.sort) {
        let sortName = ctx.query.sort,
          descending = ctx.query.sort.charAt(0) == '-';
        if (descending) {
          sortName = ctx.query.sort.substr(1);
          action = 'query';
          params.ScanIndexForward = false;
          params.KeyConditionExpression = '#t = :t';
          params.ExpressionAttributeNames = {'#t': '-t'};
          params.ExpressionAttributeValues = {':t': {N: '1'}};
        }
        params.IndexName = this.sortableIndices[sortName];
      }
      params = this.massParams(ctx, params);
      ctx.body = await this.adapter.getAllByParams(params, action, {offset: ctx.query.offset, limit: ctx.query.limit}, ctx.query.fields);
    },
    async deleteAll(ctx) {
      const params = this.massParams(ctx);
      await this.adapter.deleteAllByParams(params, 'scan');
      ctx.status = 204;
    },
    async cloneAll(ctx) {
      const params = this.massParams(ctx);
      await this.adapter.cloneAllByParams(params, 'scan', item => ({...item, name: item.name + ' COPY'}));
      ctx.status = 204;
    },
    async load(ctx) {
      const data = JSON.parse(await fs.promises.readFile(path.join(__dirname, 'data.json')));
      await this.adapter.putAll(data);
      ctx.status = 204;
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

  // item operations
  .post('/', async ctx => adapter.post(ctx))
  .get('/:planet', async ctx => adapter.get(ctx))
  .put('/:planet', async ctx => adapter.put(ctx))
  .patch('/:planet', async ctx => adapter.patch(ctx))
  .delete('/:planet', async ctx => adapter.delete(ctx));

module.exports = router;
