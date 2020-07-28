# dynamodb-toolkit [![NPM version][npm-img]][npm-url]

[npm-img]:      https://img.shields.io/npm/v/dynamodb-toolkit.svg
[npm-url]:      https://npmjs.org/package/dynamodb-toolkit

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
  * `patch(item [, params])` based on `patchByKey(key, item [, force [, params]])`
  * `clone(item, mapFn [, force [, params]])` AKA `cloneByKey(key, mapFn [, force [, params]])`
* Mass operation building blocks:
  * `getAllByParams(params, options [, fields])`
  * `getByKeys(keys [, fields [, params]])`
  * `getAll(options, item [, index])`
  * `putAll(items)`
  * `deleteAllByParams(params)`
  * `deleteByKeys(keys)`
  * `deleteAll(options, item [, index])`
  * `cloneAllByParams(params, mapFn)`
  * `cloneByKeys(keys, mapFn)`
  * `cloneAll(options, mapFn, item [, index])`
* Utilities:
  * `makeParams(options, project, params, skipSelect)` &mdash; prepares a DynamoDB `params`.
  * `cloneParams(params)` &mdash; a shallow copy of `params` with forcing a table name.
  * `fromDynamo(item, fieldMap)` &mdash; imports data from the DynamoDB format.
  * `toDynamo(item)` &mdash; exports data to the DynamoDB format.
  * `toDynamoKey(item, index)` &mdash; exports a key to the DynamoDB format for a given index.

The library provides a helper for [Koa](https://koajs.com/) to write HTTP REST servers. It takes care of query parameters, extracts POST/PUT JSON bodies,
sends responses encoded as JSON with proper HTTP status codes, and prepares parameters for mass operations.

# Example

This is the annotated [tests/routes.js](https://github.com/uhop/dynamodb-toolkit/blob/master/tests/routes.js):

## Include dependencies

```js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const Router = require('koa-router');

const AWS = require('aws-sdk');

const Adapter = require('../Adapter');
const KoaAdapter = require('../helpers/KoaAdapter');
const makeClient = require('../utils/makeClient');
const subsetObject = require('../utils/subsetObject');
```

## Create a DynamoDB client

```js
const client = makeClient(AWS, {docClient: false});
```

## Define a DynamoDB adapter

```js
const adapter = new Adapter({
  client,
  table: 'test',
  keyFields: ['name'],
  searchable: {name: 1, climate: 1, terrain: 1}, // searchable fields

  prepare(item, isPatch) {
    // convert to an item which will be stored in a database
    // we can add some technical fields, e.g., fields to search on
    const data = Object.keys(item).reduce((acc, key) => {
      if (key.charAt(0) !== '-') {
        acc[key] = item[key];
        if (this.searchable[key] === 1) {
          acc['-search-' + key] = (item[key] + '').toLowerCase();
        }
      }
      return acc;
    }, {});
    if (isPatch) {
      delete data.name; // removes the key field
    } else {
      data['-t'] = 1; // create the technical field for an index
    }
    return data;
  },

  prepareKey(item, index) {
    // make a key for our database
    const key = {name: item.name};
    if (index) { // we have only one index
      // our index requires an artificial field
      key.IndexName = index;
      key['-t'] = 1;
    }
    return key;
  },

  prepareListParams(_, index) {
    // prepare params for a list of items
    index = index || '-t-name-index';
    return {
      IndexName: index,
      KeyConditionExpression: '#t = :t',
      ExpressionAttributeNames: {'#t': '-t'},
      ExpressionAttributeValues: this.toDynamoRaw({':t': 1})
    };
  },

  revive(item, fields) {
    // convert back to our original item returning only requested fields
    if (fields) return subsetObject(item, fields);
    // custom subsetting: remove all technical fields
    return Object.keys(item).reduce((acc, key) => {
      if (key.charAt(0) !== '-') {
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

  augmentItemFromContext(item, ctx) {
    if (ctx.params.planet) {
      item.name = ctx.params.planet;
    }
    return item;
  },

  augmentCloneFromContext(ctx) {
    // how to transform an object when cloning (the default)
    return item => ({...item, name: item.name + ' COPY'});
  },

  async getAll(ctx) {
    // custom getAll(), which supports sorting
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
    // custom operation
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'data.json.gz'))));
    await this.adapter.putAll(data);
    ctx.body = {processed: data.length};
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
```

It cannot be simpler than that!

# Documentation

See [wiki](https://github.com/uhop/dynamodb-toolkit/wiki) for the full documentation.

# Versions

- 2.0.1 *Bug fix in the default implementation of `revive()`.*
- 2.0.0 *Minor API change, better support for paths, support for `AWS.DynamoDB.DocumentClient`, and so on.*
- 1.16.0 *Switched conversion to `AWS.DynamoDB.Convert`, added `getPath()` and `setPath()` utilities.*
- 1.15.1 *Added `seq()` for sequential asynchronous operations.*
- 1.15.0 *Updated API to work with "db-raw" objects from a database.*
- 1.14.0 *Updated API to work with "raw" objects from a database.*
- 1.13.9 *Added an overridable clone function.*
- 1.13.8 *Serialized generic mass operations. Slower but less resource consumption.*
- 1.13.7 *Better work with boolean results in mass operations.*
- 1.13.6 *Bugfix to return a number of processed records from generic mass operations.*
- 1.13.5 *Bugfix to unbreak generic ops.*
- 1.13.4 *Bugfix in generic operations.*
- 1.13.3 *Added `addKeyFields()`, simplified `getAllByParams()`, fixed `genericDeleteAllByParams()`.*
- 1.13.2 *Bugfix in pagination with filtering.*
- 1.13.1 *Added an alternative way to go over database records: `iterateList()`.*
- 1.13.0 *Refactored `xxxList()` functions to use `getBatch()` and `applyBatch()`.*
- 1.12.0 *Updated `getTotal()` API and added a no-limit version of `paginateList()`.*
- 1.11.2 *Typo fix in `Adapter.makeCheck()`.*
- 1.11.1 *Bugfix in `Adapter` related to transactions.*
- 1.11.0 *New style of batches, support for transactional consistency checks.*
- 1.10.6 *Bugfix in `applyTransaction()`.*
- 1.10.5 *Added generic implementations of compound operations.*
- 1.10.4 *Added `checkExistence()` helper.*
- 1.10.3 *Minor improvements, added batch makers working on raw keys and items.*
- 1.10.2 *Restructured names to keys methods of `KoaAdapter`.*
- 1.10.1 *Added `xxxByNames` methods to `KoaAdapter`.*
- 1.10.0 *Added support for multi-table batches and transactions. Minor overall improvements.*
- 1.9.2 *Added profile-related utilities.*
- 1.9.1 *Bugfix: added missing normalization for `scanAllByParams()`, updated dev deps.*
- 1.9.0 *Added: projecting sub-objects, new way to clone objects, and unit tests.*
- 1.8.2 *Bugfix in `scanAllByParams()`.*
- 1.8.1 *Added `makeListParams() ` and `scanAllByParams()`.*
- 1.8.0 *New signature for `readList()`, added streamable reading.*
- 1.7.2 *Technical release.*
- 1.7.1 *Minor performance tweaks, bugfixes in the test case.*
- 1.7.0 *Added `deleteByNames()` and `cloneByNames()`, renamed `getAllByKeys()` to `getByKeys()`.*
- 1.6.3 *Added `updateParams()` to add writing conditions.*
- 1.6.2 *Bugfix in `KoaAdapter`'s mass methods: augmenting instead of copying.*
- 1.6.1 *Return of `clone()` and `cloneAll()` as default methods.*
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
