# Architecture

`dynamodb-toolkit` is a no-dependency CommonJS micro-library for AWS DynamoDB. It targets two use cases: opinionated REST handlers (via `KoaAdapter`) and high-throughput command-line jobs (via `Adapter` and the standalone utilities). All runtime dependencies are dev-only — the `aws-sdk` client is supplied by the consumer.

## Project layout

```
index.js                   # Re-exports Adapter
Adapter.js                 # Adapter class — CRUD, batch builders, mass ops, generic ops, utilities
helpers/
├── KoaAdapter.js          # Koa wrapper: ctx → Adapter call → ctx.body / ctx.status
└── isTrue.js              # isTrue(query, name), isConsistent(query)
utils/                     # Standalone DynamoDB utilities (each file = one named export)
├── makeClient.js          # Build AWS.DynamoDB or DocumentClient with profile/region resolution
├── createClient.js        # Compatibility wrapper over makeClient
├── converter.js           # Local clone of AWS.DynamoDB.Converter (input/output/marshall/unmarshall)
├── convertTypes.js        # convertTo/convertFrom respecting `specialTypes` (Sets vs Lists)
├── applyBatch.js          # batchWriteItem with chunking (LIMIT 25)
├── applyTransaction.js    # transactWriteItems builder (Put/Update/Delete/ConditionCheck)
├── batchGet.js            # batchGetItem with backoff/retries
├── batchWrite.js          # batchWriteItem with backoff/retries
├── backoff.js             # Exponential backoff helper used across mass ops
├── readList.js            # readList(client, params) → {items, nextParams}; readList.byKeys(...)
├── readListByKeys.js      # batchGet helper for arrays of keys
├── readOrderedListByKeys.js  # Preserves caller key order across batchGet retries
├── writeList.js           # Mass put with chunking + backoff
├── deleteList.js          # Mass delete by params or by keys
├── copyList.js            # Mass copy via params/keys with mapFn
├── moveList.js            # Mass move (copy + delete) via params/keys with mapFn
├── iterateList.js         # async iterator over scan/query pages
├── paginateList.js        # Offset/limit pagination on top of scan/query
├── paginateListNoLimit.js
├── getBatch.js            # Low-level batch reader
├── getTotal.js            # Count items via Select=COUNT
├── getTransaction.js      # transactGetItems builder
├── prepareUpdate.js       # Build UpdateExpression from a patch + delete props (path-aware)
├── addProjection.js       # Add ProjectionExpression, dedupe attribute aliases
├── filtering.js           # Build FilterExpression for `searchable` fields
├── cleanParams.js         # Drop empty Expression* members
├── cloneParams.js         # Shallow clone with own-property check
├── combineParams.js       # Merge two params, dedupe attribute aliases
├── normalizeFields.js     # 'a,b,c' | ['a','b'] → ['a','b','c']
├── subsetObject.js        # Pick a subset of fields from an object
├── getPath.js             # Dotted-path read
├── setPath.js             # Dotted-path write
├── deletePath.js          # Dotted-path delete
├── applyPatch.js          # Apply a patch object in memory (mirrors prepareUpdate semantics)
├── getProfileName.js      # Resolve AWS_PROFILE / AWS_DEFAULT_PROFILE
├── random.js, seq.js, sleep.js  # Tiny helpers
tests/
├── server.js              # Koa test server (port 3000, env HOST/PORT)
├── routes.js              # Adapter + KoaAdapter wired to table 'test' (Star Wars planets)
├── data.json.gz           # Fixture, loaded via PUT /-load
└── Unit test dynamodb-toolkit.postman_collection.json
wiki/                      # Git submodule: github.com/uhop/dynamodb-toolkit.wiki
```

## Core concepts

### Adapter

`Adapter` is the central class. One Adapter typically maps to one logical entity (often one table). Construction:

```js
const adapter = new Adapter({
  client,            // AWS.DynamoDB or AWS.DynamoDB.DocumentClient instance
  table: 'planets',
  keyFields: ['name'],            // partition key first, then sort key if any
  specialTypes: {tags: 1},        // arrays stored as DynamoDB Sets
  projectionFieldMap: {},         // alias → real field for projections
  searchable: {name: 1},          // fields that get '-search-<name>' lowercase copies
  searchablePrefix: '-search-',
  indirectIndices: {},            // index name → 1 if it stores keys instead of full items
  prepare(item, isPatch) { ... },
  revive(rawItem, fields) { ... },
  validateItem(item, isPatch) { ... },
  checkConsistency(batch) { ... }
});
```

`Adapter.Raw` and `Adapter.DbRaw` are marker classes:

- `Raw`: caller-shaped JSON (skip `prepare()` but still convert to DynamoDB wire format if needed).
- `DbRaw`: already in DynamoDB wire format (skip both `prepare()` and conversion).

`fromDynamo`/`toDynamo`/`toDynamoKey` consult `isDocClient` (set in the constructor from `typeof client.createSet == 'function'`) to decide whether conversion is needed.

### Method families

| Family               | Methods                                                                                     | Notes                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Batch builders       | `makeGet`, `makeCheck`, `makePost`, `makePut`, `makePatch`, `makeDelete`                    | Return `{action, params}` (and sometimes `adapter`). Used by CRUD + transactions.    |
| CRUD                 | `get`/`getByKey`, `post`, `put`, `patch`/`patchByKey`, `delete`/`deleteByKey`               | Each consults `checkConsistency()` and may upgrade to `applyTransaction`.            |
| CRUD compound        | `clone`/`cloneByKey`, `move`/`moveByKey`                                                    | Read → mapFn → write (move also deletes the source in one transaction).              |
| Mass (native)        | `scanAllByParams`, `getAllByParams`, `getByKeys`, `getAll`, `putAll`, `deleteAll*`, `clone*`, `move*` | Use DynamoDB batch/transaction APIs. Honor `indirectIndices`.                |
| Mass (generic)       | `genericGetByKeys`, `genericPutAll`, `genericDeleteAllByParams`, `genericDeleteByKeys`, `genericClone*`, `genericMove*` | Sequential, item-by-item — slower but trivially correct.                |
| Utilities            | `cloneParams`, `cleanGetParams`, `checkExistence`, `makeListParams`, `addKeyFields`, `convertFrom`/`convertTo`, `fromDynamo`/`toDynamo`/`toDynamoKey`, `fromDynamoRaw`/`toDynamoRaw`, `markAsRaw`, `validateItems` | Building blocks reused by everything above. |

### Write pipeline

A typical write (`put`, `patch`, `delete`, `clone`, `move`):

1. The corresponding `make*()` builder produces a batch descriptor `{action, params}`.
2. `checkConsistency(batch)` may return additional batch items (e.g., to verify a parent row exists).
3. If `checkConsistency` returned anything, `applyTransaction(client, checks, batch[, ...more])` runs the whole thing as `transactWriteItems`. Otherwise the single op runs directly (`put`, `update`, `delete`).
4. The DocumentClient vs raw-DynamoDB action name is selected via `isDocClient` (`put` vs `putItem`, etc.).

### Read pipeline and indirect indices

`indirectIndices` marks GSIs whose projected items are key-only — you must do a second batchGet against the base table to fetch full attributes. `getByKey`, `getByKeys`, `scanAllByParams`, and `getAllByParams` all check `params.IndexName` against `indirectIndices`. When indirect:

1. First call queries the index returning only key fields.
2. Returned keys are reshaped via `restrictKey()` and run through `readOrderedListByKeys` against the base table to get full items.
3. `ignoreIndirection: true` bypasses the second hop (return whatever the index actually projects).

### Patching

`prepareUpdate(patch, deleteProps, params, separator = '.')`:

- Builds `UpdateExpression` `SET` clauses from `patch`'s own keys.
- Splits keys on `separator` (default `.`) for nested paths; pure-digit segments become array indices and are not aliased.
- Builds `REMOVE` clauses from `deleteProps`.
- Reuses any existing `ExpressionAttributeNames`/`Values`, deduping aliases via `#upk<n>` / `:upv<n>`.

`makePatch()` extracts `__delete` and `__separator` from the patch object, removes key fields, then delegates here.

### KoaAdapter

`KoaAdapter` wraps an `Adapter` and translates Koa contexts into Adapter calls:

- `augmentItemFromContext(item, ctx)` — overlays `ctx.params` onto an item (default).
- `augmentCloneFromContext(ctx)` — returns a `mapFn` that overlays `ctx.request.body`.
- `extractKeys(ctx, forceQuery)` — for `*ByNames`. Uses request body on PUT/POST, `?names=` on other methods.
- `namesToKeys(ctx, names)` — defaults to `name => ({name})`; override for compound keys.
- `makeOptions(ctx)` — pulls `consistent`, `filter`, `fields`, `offset`, `limit` from `ctx.query`.
- HTTP responses: `204` for successful writes, `404` when an item doesn't exist for read/clone/move.

The test server in `tests/routes.js` is the canonical example of subclassing `KoaAdapter` for sortable indices and bulk fixtures.

### Mass-operation backoff

`writeList`, `deleteList`, `copyList`, `moveList`, `batchGet`, `batchWrite` all chunk to DynamoDB's batch limits (25 for write, 100 for get) and retry unprocessed items via `backoff()` (exponential). They return the count of processed items.

## Module dependency graph (simplified)

```
index.js → Adapter.js
Adapter.js → utils/{applyTransaction, addProjection, converter, convertTypes,
                    prepareUpdate, paginateList, deleteList, copyList, moveList,
                    readList, readOrderedListByKeys, writeList, filtering,
                    cleanParams, cloneParams, subsetObject}

helpers/KoaAdapter.js → Adapter.js + helpers/isTrue.js

utils/applyBatch.js  → utils/batchWrite.js
utils/batchWrite.js  → utils/backoff.js
utils/batchGet.js    → utils/backoff.js
utils/readList.js    → utils/{getBatch, paginateList, readListByKeys}
utils/copyList.js    → utils/{readList, writeList}
utils/moveList.js    → utils/{readList, writeList, deleteList}
utils/createClient.js → utils/makeClient.js → utils/getProfileName.js
```

## Test server

```bash
HOST=localhost PORT=3000 npm start
```

`tests/routes.js` instantiates an Adapter against a table named `test` keyed on `name` and exposes Star Wars planets via REST. Reset the dataset with `PUT /-load` (loads `tests/data.json.gz`). Exercise endpoints with the Postman collection in `tests/`.

## Wiki

The `wiki/` directory is the GitHub wiki submodule. `Home.md` is the index. Page naming uses `:` for the section separator (e.g., `Adapter:-CRUD-methods.md`). Cross-link with `https://github.com/uhop/dynamodb-toolkit/wiki/<Page>` from main-repo files and with relative paths from inside the wiki.
