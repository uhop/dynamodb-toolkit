# dynamodb-toolkit

[![Dependencies][deps-image]][deps-url]
[![devDependencies][dev-deps-image]][dev-deps-url]
[![NPM version][npm-image]][npm-url]

No-dependencies micro-library for [AWS DynamoDB](https://aws.amazon.com/dynamodb/) to build small efficient RESTful APIs and high-performance command-line utilities.

Helps with:

* Encoding/decoding your beautiful JSON data to and fro DynamoDB internal format.
* Working with multiple databases at the same time potentially using different credentials.
* Supports vagaries of mass read/write/delete operations correctly handling throughput-related errors using the recommended exponential back-off algorithm.
* Implements efficiently on the server:
  * **Paging** (in offset/limit terms) and **sorting** on an index (both ascending and descending).
  * **Subsetting** AKA **projection** (read operations can return a subset required of fields instead of the whole shebang which can be huge especially for mass read operations &mdash; think lists and tables).
  * **Searching** AKA **filtering** (filters results using looking for a substring in a predefined set of fields).
  * **Patching** (only necessary fields are transferred to be updated/deleted).
  * **Cloning** (making updated copies in a database).
* Flexible, thoroughly asynchronous.

Supports out-of-the-box the following operations:

* Standard REST:
  * `get(key [, fields [, params]])` AKA `getByKey(key [, fields [, params]])`
  * `post(item)`
  * `put(item [, force [, params]])`
  * `delete(key [, params])` AKA `deleteByKey(key [, params])`
* Special operations:
  * `patch(item [, deep [, params]])` based on `patchByKey(key, item [, force [, params]])`
  * `clone(item, mapFn [, deep [, params]])` AKA `cloneByKey(key, mapFn [, force [, params]])`
* Mass operation building blocks:
  * `getAllByParams(params, options [, fields])`
  * `getAllByKeys(keys [, fields [, params]])`
  * `putAll(items)`
  * `deleteAllByParams(params)`
  * `cloneAllByParams(params, mapFn)`

The library provides a helper for [Koa](https://koajs.com/) to write HTTP REST servers. It takes care of query parameters, extracts POST/PUT JSON bodies,
sends responses encoded as JSON with proper HTTP status codes, and prepares parameters for mass operations.

# Example

This is the annotated [tests/routes.js](https://github.com/uhop/dynamodb-toolkit/blob/master/tests/routes.js):

## Include dependencies

```js
const fs = require('fs');
const path = require('path');

const Router = require('koa-router');

const AWS = require('aws-sdk');

const Adapter = require('dynamodb-toolkit');
const KoaAdapter = require('dynamodb-toolkit/helpers/KoaAdapter');
```

## Create a DynamoDB client

```js
AWS.config.update({region: 'us-east-1'});
const client = new AWS.DynamoDB();

// Example with different credentials:
// const credentials = new AWS.SharedIniFileCredentials(
//   {profile: 'production'});
// const client = new AWS.DynamoDB({credentials: credentials});
```

## Define a DynamoDB adapter

```js
const adapter = new Adapter({
  client,
  table: 'test',
  keyFields: ['name'],
  searchable: {name: 1, climate: 1, terrain: 1}, // searchable fields
  prepare(item) {
    // convert to an item which will be stored in a database
    // we can add some technical fields, e.g., fields to search on
    const data = Object.keys(item).reduce((acc, key) => {
      if (key.charAt(0) !== '-') {
        acc[key] = item[key];
        if (this.searchable[key] === 1)
          acc['-search-' + key] = (item[key] + '').toLowerCase();
      }
      return acc;
    }, {});
    data['-t'] = 1;
    return data;
  },
  revive(item, fieldMap) {
    // convert back to our original item
    // we can remove all technical fields we added before
    return Object.keys(item).reduce((acc, key) => {
      if (!fieldMap || fieldMap[key] === 1) {
        acc[key] = item[key];
      }
      return acc;
    }, {});
  }
});
```

We mostly defined how to transform our object to something we keep in a database and back.
By default these operations just return their `item` parameter so we don't need to specify them if we don't want any transformations.

## Define a Koa adapter

```js
const koaAdapter = new KoaAdapter(adapter, {
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
    params = this.makeParams(ctx, false, params);
    ctx.body = await this.adapter.getAllByParams(params,
      {offset: ctx.query.offset, limit: ctx.query.limit},
        ctx.query.fields);
  },
  async deleteAll(ctx) {
    const params = this.makeParams(ctx);
    ctx.body = {processed: await this.adapter.deleteAllByParams(params)};
  },
  async cloneAll(ctx) {
    const params = this.makeParams(ctx);
    ctx.body = {processed: await this.adapter.cloneAllByParams(params,
      item => ({...item, name: item.name + ' COPY'}))};
  },
  async load(ctx) {
    const data = JSON.parse(await fs.promises.readFile(
      path.join(__dirname, 'data.json')));
    await this.adapter.putAll(data);
    ctx.body = {processed: data.length};
  },
  async getByNames(ctx) {
    if (!ctx.query.names) throw new Error(
      'Query parameter "names" was expected. ' +
      'Should be a comma-separated list of planet names.');
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
```

Most operations were trivial. Some operations takes more than a couple of lines for the flexibility sake.

## Define the routing table

```js
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
  .delete('/:planet', async ctx => koaAdapter.delete(ctx));

module.exports = router;
```

It cannot be simpler than that!

# Documentation

See [wiki](https://github.com/uhop/dynamodb-toolkit/wiki) for the full documentation.

# Versions

- 1.6.0 *Added `doClone()`.*
- 1.5.0 *Refactored, simplified, added more canned list-based operations.*
- 1.4.1 *Added ability to return `undefined` for mapping functions.*
- 1.4.0 *Added helper methods: `toDynamo()`, `toDynamoKey()`, `fromDynamo()`.*
- 1.3.0 *`clone()` added to `KoaAdapter`. A related bug was fixed.*
- 1.2.0 *Major refactoring of internals. Some API changes.*
- 1.1.1 *Bugfix: added the missing index file.*
- 1.1.0 *Made a search prefix a parameter.*
- 1.0.0 *The initial public release*

# License

[The 3-Clause BSD License](https://opensource.org/licenses/BSD-3-Clause)

# Acknowledgements

The test JSON file containing planets of the Star Wars universe is extracted from [SWAPI](https://swapi.co/) and used under BSD license.


[npm-image]:       https://img.shields.io/npm/v/dynamodb-toolkit.svg
[npm-url]:         https://npmjs.org/package/dynamodb-toolkit
[deps-image]:      https://img.shields.io/david/uhop/dynamodb-toolkit.svg
[deps-url]:        https://david-dm.org/uhop/dynamodb-toolkit
[dev-deps-image]:  https://img.shields.io/david/dev/uhop/dynamodb-toolkit.svg
[dev-deps-url]:    https://david-dm.org/uhop/dynamodb-toolkit?type=dev
