# dynamodb-toolkit [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/dynamodb-toolkit.svg
[npm-url]: https://npmjs.org/package/dynamodb-toolkit

No-dependencies opinionated micro-library for [AWS DynamoDB](https://aws.amazon.com/dynamodb/)
to build small efficient RESTful APIs and high-performance command-line utilities with a simple intuitive API.

* Designed to work with existing code. Your legacy code can be gradually improved. No special requirements for database tables or indices!
* Battle-proven. Used in mission-critical applications.
* Provides a flexible way preparing your data objects for storing and reviving them back:
  * Supports complex indexing: design your own queries!
  * Validate objects before storing.
  * Check the consistency of a database before storing objects.
  * Rich set of efficient read/write/delete/clone/move operations.
  * Various low-level and high-level utilities for DynamoDB.
* Automatically encoding/decoding your beautiful JSON data to and fro DynamoDB internal format.
  * Supports [AWS.DynamoDB](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html) clients.
  * Supports [AWS.DynamoDB.DocumentClient](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html) clients.
* Supports vagaries of mass read/write/delete operations correctly handling throughput-related errors using the recommended exponential back-off algorithm.
  * Supports transactions and batch requests.
* Implements **efficiently on the server**:
  * **Paging** (in offset/limit terms) and **sorting** on an index (ascending and descending) to interface with list/table visual components.
  * **Subsetting** AKA **projection**: read operations can return a subset required of fields instead of the whole shebang which can be huge especially for mass read operations &mdash; think lists and tables.
  * **Searching** AKA **filtering**: filters results looking for a substring in a predefined set of fields.
  * **Patching**: only necessary fields are transferred to be updated/deleted.
  * **Cloning**: making updated copies in a database.
  * **Moving**: effectively renaming objects.
* Thoroughly asynchronous. No callbacks.
* Working with multiple databases at the same time potentially using different credentials.

Extensively documented: see [the wiki](https://github.com/uhop/dynamodb-toolkit/wiki).

## Example

```js
const Adapter = require('dynamodb-toolkit');

const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-2'});

const adapter = new Adapter({
  client: new AWS.DynamoDB(),
  table: 'test',
  keyFields: ['name']
});

// ...

const planet = await adapter.get({name: 'Alderaan'});
await adapter.patch({name: planet.name, diameter: planet.diameter * 2});
// ...
await adapter.clone({name: planet.name}, planet => {
  const newPlanet = {...planet, name: planet.name + ' Two'};
  return newPlanet;
});
await adapter.delete({name: planet.name});
```

# Adapter

## What you have to define yourself

* Data properties:
  * `keyFields` &mdash; a **required** list of keys starting with the partition key.
* Methods:
  * `prepare(item [, isPatch])` &mdash; prepares an item to be stored in a database. It can add or transform properties.
  * `revive(rawItem [, fields])` &mdash; transforms an item after reading it from a database. Its counterpart is `prepare()`.

## What you may want to define yourself

* Data properties:
  * `specialTypes` &mdash; an optional dictionary, which arrays should be stored as DynamoDB sets.
  * `projectionFieldMap` &mdash; an optional dictionary to map top-level properties to different fields.
    * Frequently used with hierarchical indices.
  * `searchable` &mdash; an optional dictionary of searchable top-level fields.
  * `searchablePrefix` &mdash; an optional prefix to create technical searchable fields.
* Methods:
  * `prepareKey(key [, index])` &mdash; prepares a database key.
  * `restrictKey(rawKey [, index])` &mdash; removes unwanted properties from a key. Different indices may have different set of properties.
  * `prepareListParams(item [, index])` &mdash; creates `params` for a given item and an index to list related items.
  * `updateParams(params, options)` &mdash; updates `params` for different writing operations.
  * `validateItem(item [, isPatch])` &mdash; asynchronously validates an item.
  * `checkConsistency(batch)` &mdash; asynchronously produces an additional batch of operations to check for consistency before updating a database.

## What you immediately get

* Standard REST:
  * `get(key [, fields [, params [, returnRaw]]])`
    * AKA `getByKey(key [, fields [, params [, returnRaw]]])`
  * `post(item)`
  * `put(item [, force [, params]])`
  * `delete(key [, params])`
    * AKA `deleteByKey(key [, params])`
* Special operations:
  * `patch(item [, params])` based on `patchByKey(key, item [, force [, params]])`
  * `clone(item, mapFn [, force [, params [, returnRaw]]])`
    * AKA `cloneByKey(key, mapFn [, force [, params [, returnRaw]]])`
  * `move(item, mapFn [, force [, params [, returnRaw]]])`
    * AKA `moveByKey(key, mapFn [, force [, params [, returnRaw]]])`
* Batch/transaction helpers:
  * `makeGet(key [, fields [, params]])`
  * `makePost(item)`
  * `makePut(item [, force [, params]])`
  * `makeDelete(key [, params])`
  * `makeCheck(key [, params])`
  * `makePatch(key, item [, params])`
* Mass operations:
  * `scanAllByParams(params [, fields [, returnRaw]])`
  * `getAllByParams(params [, options [, returnRaw]])`
  * `getByKeys(keys [, fields [, params [, returnRaw]]])`
  * `getAll(options, item [, index [, returnRaw]])`
  * `putAll(items)`
  * `deleteAllByParams(params)`
  * `deleteByKeys(keys)`
  * `deleteAll(options, item [, index])`
  * `cloneAllByParams(params, mapFn [, returnRaw])`
  * `cloneByKeys(keys, mapFn [, returnRaw])`
  * `cloneAll(options, mapFn, item [, index [, returnRaw]])`
  * `moveAllByParams(params, mapFn [, returnRaw])`
  * `moveByKeys(keys, mapFn [, returnRaw])`
  * `moveAll(options, mapFn, item [, index [, returnRaw]])`
* Alternative generic implementations formulated in terms of other methods:
  * `genericGetByKeys(keys [, fields [, params [, returnRaw]]])`
  * `genericPutAll(items)`
  * `genericDeleteAllByParams(params)`
  * `genericDeleteByKeys(keys)`
  * `genericCloneAllByParams(params, mapFn [, returnRaw])`
  * `genericCloneByKeys(keys, mapFn [, returnRaw])`
  * `genericMoveAllByParams(params, mapFn [, returnRaw])`
  * `genericMoveByKeys(keys, mapFn [, returnRaw])`
* Utilities:
  * `makeParams(options [, project [, params [, skipSelect]]])` &mdash; prepares a DynamoDB `params`.
  * `cloneParams(params)` &mdash; a shallow copy of `params` with forcing a table name.
  * `cleanGetParams(params)` &mdash; removes `ConditionExpression` from `params`.
  * `checkExistence(params [, invert])` &mdash; generates an (non-)existence of an item.
  * `makeListParams(options, project, item [, index])` &mdash; prepares `params` to list items.
  * `addKeyFields(params [, skipSelect])` &mdash; adds a projection of key fields to `params`.
  * `convertTo(item [, ignoreSpecialTypes])` &mdash; converts to the DynamoDB internal format.
  * `convertFrom(item [, ignoreSpecialTypes])` &mdash; converts from the DynamoDB internal format.
  * `fromDynamo(item [, fields [, returnRaw]])` &mdash; converts to a given format. Runs user-defined transformations.
  * `toDynamo(item)` &mdash; converts any supported format to a given DynamoDB client. Runs user-defined transformations.
  * `toDynamoKey(key [, index])` &mdash; converts an item to a valid DynamoDB key. Runs user-defined transformations.
  * `fromDynamoRaw(item)` &mdash; converts from a client-specific format.
  * `toDynamoRaw(item)` &mdash; converts to a client-specific format.
  * `validateItems(items [, isPatch])` &mdash; asynchronously validates all items.

# Stand-alone utilities

Included utility functions:

* Helping to create clients with all necessary settings.
* Various operations on parameters (`params`) including adding projections, filtering.
* Batching operations for efficiency.
* Transactions.
* Preparing patches.
* Mass operations: reading by keys, list with pagination, copying, deleting, iterating over, getting totals, writing.
* More.

# Koa

The library provides a helper for [Koa](https://koajs.com/) to write HTTP REST servers. It takes care of query parameters,
extracts POST/PUT JSON bodies, sends responses encoded as JSON with proper HTTP status codes, and prepares parameters for
mass operations.

## Example

Define a Koa adapter:

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
    // how to transform an object when cloning/moving (the default)
    return item => ({...item, name: item.name + ' COPY'});
  },

  async getAll(ctx) {
    // custom getAll(), which supports sorting
    let index, descending;
    if (ctx.query.sort) {
      let sortName = ctx.query.sort;
      descending = ctx.query.sort[0] == '-';
      if (descending) {
        sortName = sortName.substr(1);
      }
      index = this.sortableIndices[sortName];
    }
    const options = this.makeOptions(ctx);
    options.descending = !!descending;
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

Most operations were trivial. Some operations take more than a couple of lines for flexibility's sake.

Define the routing table:

```js
const router = new Router();

router
  // mass operations
  .get('/', async ctx => koaAdapter.getAll(ctx))
  .delete('/', async ctx => koaAdapter.deleteAll(ctx))
  .put('/-load', async ctx => koaAdapter.load(ctx))
  .put('/-clone', async ctx => koaAdapter.cloneAll(ctx))
  .put('/-clone-by-names', async ctx => koaAdapter.cloneByNames(ctx))
  .put('/-move', async ctx => koaAdapter.moveAll(ctx))
  .put('/-move-by-names', async ctx => koaAdapter.moveByNames(ctx))
  .get('/-by-names', async ctx => koaAdapter.getByNames(ctx))
  .delete('/-by-names', async ctx => koaAdapter.deleteByNames(ctx))

  // item operations
  .post('/', async ctx => koaAdapter.post(ctx))
  .get('/:planet', async ctx => koaAdapter.get(ctx))
  .put('/:planet', async ctx => koaAdapter.put(ctx))
  .patch('/:planet', async ctx => koaAdapter.patch(ctx))
  .delete('/:planet', async ctx => koaAdapter.delete(ctx))
  .put('/:planet/-clone', async ctx => koaAdapter.clone(ctx))
  .put('/:planet/-move', async ctx => koaAdapter.move(ctx));

module.exports = router;
```

It cannot be simpler than that!

# Documentation

See [wiki](https://github.com/uhop/dynamodb-toolkit/wiki) for the full documentation.

# Versions

- 2.1.0 *Added `moveXXX()` operations, some minor implementation improvements.*
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
