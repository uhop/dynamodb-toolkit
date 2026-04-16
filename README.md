# dynamodb-toolkit [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/dynamodb-toolkit.svg
[npm-url]: https://npmjs.org/package/dynamodb-toolkit

No-dependencies opinionated micro-library for [AWS DynamoDB](https://aws.amazon.com/dynamodb/)
to build small efficient RESTful APIs and high-performance command-line utilities with a simple intuitive API.

- Designed to work with existing code. Your legacy code can be gradually improved. No special requirements for database tables or indices!
- Battle-proven. Used in mission-critical applications.
- Provides a flexible way preparing your data objects for storing and reviving them back:
  - Supports complex indexing: design your own queries!
  - Validate objects before storing.
  - Check the consistency of a database before storing objects.
  - Rich set of efficient read/write/delete/clone/move operations.
  - Various low-level and high-level utilities for DynamoDB.
- Automatically encoding/decoding your beautiful JSON data to and fro DynamoDB internal format.
  - Supports [AWS.DynamoDB](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html) clients.
  - Supports [AWS.DynamoDB.DocumentClient](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html) clients.
- Supports vagaries of mass read/write/delete operations correctly handling throughput-related errors using the recommended exponential back-off algorithm.
  - Supports transactions and batch requests.
- Implements **efficiently on the server**:
  - **Paging** (in offset/limit terms) and **sorting** on an index (ascending and descending) to interface with list/table visual components.
  - **Subsetting** AKA **projection**: read operations can return a subset required of fields instead of the whole shebang which can be huge especially for mass read operations &mdash; think lists and tables.
  - **Searching** AKA **filtering**: filters results looking for a substring in a predefined set of fields.
  - **Patching**: only necessary fields are transferred to be updated/deleted.
  - **Cloning**: making updated copies in a database.
  - **Moving**: effectively renaming objects.
- Thoroughly asynchronous. No callbacks.
- Working with multiple databases at the same time potentially using different credentials.

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

The full documentation: [Adapter](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter). Here is a cheatsheet:

## What you have to define yourself

- Data properties:
  - [keyFields](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#keyfields) &mdash; a **required** list of keys starting with the partition key.
- Methods:
  - [prepare(item [, isPatch])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#prepareitem--ispatch) &mdash; prepares an item to be stored in a database. It can add or transform properties.
  - [revive(rawItem [, fields])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#reviverawitem--fields) &mdash; transforms an item after reading it from a database. Its counterpart is `prepare()`.

## What you may want to define yourself

- Data properties:
  - [specialTypes](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#specialtypes) &mdash; an optional dictionary, which arrays should be stored as DynamoDB sets.
  - [projectionFieldMap](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#projectionfieldmap) &mdash; an optional dictionary to map top-level properties to different fields.
    - Frequently used with hierarchical indices.
  - [searchable](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#searchable) &mdash; an optional dictionary of searchable top-level fields.
  - [searchablePrefix](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#searchableprefix) &mdash; an optional prefix to create technical searchable fields.
  - [indirectIndices](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#indirectindices) &mdash; an optional dictionary, which sets what indices contain key fields instead of actual items.
- Methods:
  - [prepareKey(key [, index])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#preparekeykey--index) &mdash; prepares a database key.
  - [restrictKey(rawKey [, index])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#restrictkeyrawkey--index) &mdash; removes unwanted properties from a key. Different indices may have different set of properties.
  - [prepareListParams(item [, index])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#preparelistparamsitem--index) &mdash; creates `params` for a given item and an index to list related items.
  - [updateParams(params, options)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#updateparamsparams--options) &mdash; updates `params` for different writing operations.
  - [validateItem(item [, isPatch])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#async-validateitemitem--ispatch) &mdash; asynchronously validates an item.
  - [checkConsistency(batch)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-settings#async-checkconsistencybatch) &mdash; asynchronously produces an additional batch of operations to check for consistency before updating a database.

## What you immediately get

- Standard REST (CRUD):
  - [get(key [, fields [, params [, returnRaw [, ignoreIndirection]]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-getkey--fields--params--returnraw--ignoreindirection)
    - AKA [getByKey(key [, fields [, params [, returnRaw [, ignoreIndirection]]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-getbykeykey--fields--params--returnraw--ignoreindirection)
  - [post(item)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-postitem)
  - [put(item [, force [, params]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-putitem--force--params)
  - [delete(key [, params])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-deletekey--params)
    - AKA [deleteByKey(key [, params])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-deletebykeykey--params)
- Special operations:
  - [patch(item [, params])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-patchitem--params)
    - AKA [patchByKey(key, item [, force [, params]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-patchbykeykey-item--params)
  - [clone(item, mapFn [, force [, params [, returnRaw]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-cloneitem-mapfn--force--params--returnraw)
    - AKA [cloneByKey(key, mapFn [, force [, params [, returnRaw]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-clonebykeykey-mapfn--force--params--returnraw)
  - [move(item, mapFn [, force [, params [, returnRaw]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-moveitem-mapfn--force--params--returnraw)
    - AKA [moveByKey(key, mapFn [, force [, params [, returnRaw]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-CRUD-methods#async-movebykeykey-mapfn--force--params--returnraw)
- Batch/transaction helpers:
  - [makeGet(key [, fields [, params]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-batch-methods#async-makegetkey--fields--params)
  - [makePost(item)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-batch-methods#async-makepostitem)
  - [makePut(item [, force [, params]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-batch-methods#async-makeputitem--force--params)
  - [makeDelete(key [, params])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-batch-methods#async-makedeletekey--params)
  - [makeCheck(key [, params])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-batch-methods#async-makecheckkey-params)
  - [makePatch(key, item [, params])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-batch-methods#async-makepatchkey-item--params)
- Mass operations:
  - [scanAllByParams(params [, fields [, returnRaw [, ignoreIndirection]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-scanallbyparamsparams--fields--returnraw--ignoreindirection)
  - [getAllByParams(params [, options [, returnRaw [, ignoreIndirection]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-getallbyparamsparams--options--returnraw--ignoreindirection)
  - [getByKeys(keys [, fields [, params [, returnRaw [, ignoreIndirection]]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-getbykeyskeys--fields--params--returnraw--ignoreindirection)
  - [getAll(options, item [, index [, returnRaw [, ignoreIndirection]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-getalloptions-item--index--returnraw--ignoreindirection)
  - [putAll(items)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-putallitems)
  - [deleteAllByParams(params)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-deleteallbyparamsparams)
  - [deleteByKeys(keys)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-deletebykeyskeys)
  - [deleteAll(options, item [, index])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-deletealloptions-item--index)
  - [cloneAllByParams(params, mapFn [, returnRaw])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-cloneallbyparamsparams-mapfn--returnraw)
  - [cloneByKeys(keys, mapFn [, returnRaw])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-clonebykeyskeys-mapfn--returnraw)
  - [cloneAll(options, mapFn, item [, index [, returnRaw]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-clonealloptions-mapfn-item--index--returnraw)
  - [moveAllByParams(params, mapFn [, returnRaw])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-moveallbyparamsparams-mapfn--returnraw)
  - [moveByKeys(keys, mapFn [, returnRaw])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-movebykeyskeys-mapfn--returnraw)
  - [moveAll(options, mapFn, item [, index [, returnRaw]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-mass-methods#async-movealloptions-mapfn-item--index--returnraw)
- Alternative generic implementations formulated in terms of other methods:
  - [genericGetByKeys(keys [, fields [, params [, returnRaw [, ignoreIndirection]]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-generic-methods#async-genericgetbykeyskeys--fields--params--returnraw--ignoreindirection)
  - [genericPutAll(items)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-generic-methods#async-genericputallitems)
  - [genericDeleteAllByParams(params)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-generic-methods#async-genericdeleteallbyparamsparams)
  - [genericDeleteByKeys(keys)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-generic-methods#async-genericdeletebykeyskeys)
  - [genericCloneAllByParams(params, mapFn [, returnRaw])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-generic-methods#async-genericcloneallbyparamsparams-mapfn--returnraw)
  - [genericCloneByKeys(keys, mapFn [, returnRaw])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-generic-methods#async-genericclonebykeyskeys-mapfn--returnraw)
  - [genericMoveAllByParams(params, mapFn [, returnRaw])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-generic-methods#async-genericmoveallbyparamsparams-mapfn--returnraw)
  - [genericMoveByKeys(keys, mapFn [, returnRaw])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-generic-methods#async-genericmovebykeyskeys-mapfn--returnraw)
- Utilities:
  - [makeParams(options [, project [, params [, skipSelect]]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#makeparamsoptions--project--params--skipselect) &mdash; prepares a DynamoDB `params`.
  - [cloneParams(params)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#cloneparamsparams) &mdash; a shallow copy of `params` with forcing a table name.
  - [cleanGetParams(params)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#cleangetparamsparams) &mdash; removes `ConditionExpression` from `params`.
  - [checkExistence(params [, invert])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#checkexistenceparams--invert) &mdash; generates an (non-)existence of an item.
  - [makeListParams(options, project, item [, index])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#makelistparamsoptions-project-item--index) &mdash; prepares `params` to list items.
  - [addKeyFields(params [, skipSelect])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#addkeyfieldsparams--skipselect) &mdash; adds a projection of key fields to `params`.
  - [convertFrom(item [, ignoreSpecialTypes])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#convertfromitem--ignorespecialtypes) &mdash; converts from the DynamoDB internal format.
  - [convertTo(item [, ignoreSpecialTypes])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#converttoitem--ignorespecialtypes) &mdash; converts to the DynamoDB internal format.
  - [fromDynamo(item [, fields [, returnRaw]])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#fromdynamoitem--fields--returnraw) &mdash; converts to a given format. Runs user-defined transformations.
  - [toDynamo(item)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#todynamoitem) &mdash; converts any supported format to a given DynamoDB client. Runs user-defined transformations.
  - [toDynamoKey(key [, index])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#todynamokeykey--index) &mdash; converts an item to a valid DynamoDB key. Runs user-defined transformations.
  - [fromDynamoRaw(item)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#fromdynamorawitem) &mdash; converts from a client-specific format.
  - [toDynamoRaw(item)](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#todynamorawitem) &mdash; converts to a client-specific format.
  - [validateItems(items [, isPatch])](https://github.com/uhop/dynamodb-toolkit/wiki/Adapter:-utilities#async-validateitemsitems--ispatch) &mdash; asynchronously validates all items.

# Stand-alone utilities

Included utility functions:

- Helping to create clients with all necessary settings.
- Various operations on parameters (`params`) including adding projections, filtering.
- Batching operations for efficiency.
- Transactions.
- Preparing patches.
- Mass operations: reading by keys, list with pagination, copying, deleting, iterating over, getting totals, writing.
- See [the wiki](https://github.com/uhop/dynamodb-toolkit/wiki) for more details.

# Koa

The library provides a helper for [Koa](https://koajs.com/) to write HTTP REST servers: [KoaAdapter](https://github.com/uhop/dynamodb-toolkit/wiki/KoaAdapter). It takes care of query parameters,
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

- 2.3.0 _Added `__separator` to a patch object._
- 2.2.0 _Added `readOrderedListByKeys()` and indirection to Adapter's GET-like methods._
- 2.1.1 _Bugfix in `addProjection()` to avoid duplicates._
- 2.1.0 _Added `moveXXX()` operations, some minor implementation improvements._
- 2.0.1 _Bugfix in the default implementation of `revive()`._
- 2.0.0 _Minor API change, better support for paths, support for `AWS.DynamoDB.DocumentClient`, and so on._
- 1.16.0 _Switched conversion to `AWS.DynamoDB.Convert`, added `getPath()` and `setPath()` utilities._
- 1.15.1 _Added `seq()` for sequential asynchronous operations._
- 1.15.0 _Updated API to work with "db-raw" objects from a database._
- 1.14.0 _Updated API to work with "raw" objects from a database._
- 1.13.9 _Added an overridable clone function._
- 1.13.8 _Serialized generic mass operations. Slower but less resource consumption._
- 1.13.7 _Better work with boolean results in mass operations._
- 1.13.6 _Bugfix to return a number of processed records from generic mass operations._
- 1.13.5 _Bugfix to unbreak generic ops._
- 1.13.4 _Bugfix in generic operations._
- 1.13.3 _Added `addKeyFields()`, simplified `getAllByParams()`, fixed `genericDeleteAllByParams()`._
- 1.13.2 _Bugfix in pagination with filtering._
- 1.13.1 _Added an alternative way to go over database records: `iterateList()`._
- 1.13.0 _Refactored `xxxList()` functions to use `getBatch()` and `applyBatch()`._
- 1.12.0 _Updated `getTotal()` API and added a no-limit version of `paginateList()`._
- 1.11.2 _Typo fix in `Adapter.makeCheck()`._
- 1.11.1 _Bugfix in `Adapter` related to transactions._
- 1.11.0 _New style of batches, support for transactional consistency checks._
- 1.10.6 _Bugfix in `applyTransaction()`._
- 1.10.5 _Added generic implementations of compound operations._
- 1.10.4 _Added `checkExistence()` helper._
- 1.10.3 _Minor improvements, added batch makers working on raw keys and items._
- 1.10.2 _Restructured names to keys methods of `KoaAdapter`._
- 1.10.1 _Added `xxxByNames` methods to `KoaAdapter`._
- 1.10.0 _Added support for multi-table batches and transactions. Minor overall improvements._
- 1.9.2 _Added profile-related utilities._
- 1.9.1 _Bugfix: added missing normalization for `scanAllByParams()`, updated dev deps._
- 1.9.0 _Added: projecting sub-objects, new way to clone objects, and unit tests._
- 1.8.2 _Bugfix in `scanAllByParams()`._
- 1.8.1 _Added `makeListParams() ` and `scanAllByParams()`._
- 1.8.0 _New signature for `readList()`, added streamable reading._
- 1.7.2 _Technical release._
- 1.7.1 _Minor performance tweaks, bugfixes in the test case._
- 1.7.0 _Added `deleteByNames()` and `cloneByNames()`, renamed `getAllByKeys()` to `getByKeys()`._
- 1.6.3 _Added `updateParams()` to add writing conditions._
- 1.6.2 _Bugfix in `KoaAdapter`'s mass methods: augmenting instead of copying._
- 1.6.1 _Return of `clone()` and `cloneAll()` as default methods._
- 1.6.0 _Added `doClone()`._
- 1.5.0 _Refactored, simplified, added more canned list-based operations._
- 1.4.1 _Added ability to return `undefined` for mapping functions._
- 1.4.0 _Added helper methods: `toDynamo()`, `toDynamoKey()`, `fromDynamo()`._
- 1.3.0 _`clone()` added to `KoaAdapter`. A related bug was fixed._
- 1.2.0 _Major refactoring of internals. Some API changes._
- 1.1.1 _Bugfix: added the missing index file._
- 1.1.0 _Made a search prefix a parameter._
- 1.0.0 _The initial public release_

# License

[The 3-Clause BSD License](https://opensource.org/licenses/BSD-3-Clause)

# Acknowledgements

The test JSON file containing planets of the Star Wars universe is extracted from [SWAPI](https://swapi.co/) and used under BSD license.
