# AGENTS.md — dynamodb-toolkit

> `dynamodb-toolkit` is a no-dependency, opinionated micro-library for AWS DynamoDB. It builds compact RESTful APIs and high-performance command-line utilities on top of either `AWS.DynamoDB` or `AWS.DynamoDB.DocumentClient`.

For project structure, module dependencies, and the architecture overview see [ARCHITECTURE.md](./ARCHITECTURE.md).
For detailed usage docs and API references see the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki).

## Setup

This project uses a git submodule for the wiki:

```bash
git clone --recursive git@github.com:uhop/dynamodb-toolkit.git
cd dynamodb-toolkit
npm install
```

If you cloned without `--recursive`, run `git submodule update --init` to populate `wiki/`.

## Commands

- **Install:** `npm install`
- **Start test server:** `npm start` (runs `node tests/server.js` on `localhost:3000`)
- **Debug test server:** `npm run debug` (runs with `--inspect-brk`)
- **Run tests:** Import `tests/Unit test dynamodb-toolkit.postman_collection.json` into Postman or run with `newman` against the running server.

There is no `npm test`, `npm run lint`, or `npm run ts-check`. The project is small and the test layer is the Postman collection driving the Koa server.

## Project structure

```
dynamodb-toolkit/
├── index.js                  # Entry point: re-exports Adapter
├── Adapter.js                # Main Adapter class (CRUD, batch, mass, generic, utility methods)
├── helpers/                  # Framework-specific adapters
│   ├── KoaAdapter.js         # Koa wrapper around Adapter
│   └── isTrue.js             # Query-string helpers (isTrue, isConsistent)
├── utils/                    # Standalone DynamoDB utilities
│   ├── makeClient.js         # Build AWS.DynamoDB or DocumentClient with profile/region
│   ├── createClient.js       # Thin wrapper over makeClient
│   ├── converter.js          # AWS.DynamoDB.Converter clone (input/output/marshall/unmarshall)
│   ├── convertTypes.js       # convertTo/convertFrom honoring `specialTypes`
│   ├── applyBatch.js         # batchWriteItem with chunking (LIMIT 25)
│   ├── applyTransaction.js   # transactWriteItems builder
│   ├── batchGet.js           # batchGetItem with retries
│   ├── batchWrite.js         # batchWriteItem with retries
│   ├── backoff.js            # Exponential backoff helper
│   ├── paginateList.js       # Offset/limit pagination over scan/query
│   ├── paginateListNoLimit.js
│   ├── readList.js           # Scan/query → items + nextParams; readList.byKeys
│   ├── readListByKeys.js
│   ├── readOrderedListByKeys.js
│   ├── writeList.js          # Mass put with batching + backoff
│   ├── deleteList.js         # Mass delete by params or keys
│   ├── copyList.js           # Mass copy via params or keys with mapFn
│   ├── moveList.js           # Mass move (copy + delete) via params or keys
│   ├── iterateList.js        # Async iterator over scan/query
│   ├── getBatch.js           # Low-level batch reader
│   ├── getTotal.js           # Count items via Select=COUNT
│   ├── getTransaction.js     # transactGetItems builder
│   ├── prepareUpdate.js      # Build UpdateExpression from a patch + delete props
│   ├── addProjection.js      # Add ProjectionExpression / merge attribute names
│   ├── filtering.js          # Build FilterExpression for searchable fields
│   ├── cleanParams.js        # Drop empty Expression* members
│   ├── cloneParams.js        # Shallow-clone a DynamoDB params object
│   ├── combineParams.js      # Merge two params, deduping attribute aliases
│   ├── normalizeFields.js    # Normalize a fields list (string|array → array)
│   ├── subsetObject.js       # Pick a subset of fields from an object
│   ├── getPath.js / setPath.js / deletePath.js  # Dotted-path object access
│   ├── applyPatch.js         # Apply a patch object to an in-memory item
│   ├── getProfileName.js     # Resolve AWS_PROFILE / AWS_DEFAULT_PROFILE
│   ├── random.js             # Tiny random helpers
│   ├── seq.js                # Sequential async runner
│   └── sleep.js              # `await sleep(ms)`
├── tests/
│   ├── server.js             # Koa test server (port 3000, env HOST/PORT)
│   ├── routes.js             # Adapter + KoaAdapter wired against table 'test'
│   ├── data.json.gz          # Star Wars planets fixture (loaded via PUT /-load)
│   └── Unit test dynamodb-toolkit.postman_collection.json
└── wiki/                     # GitHub wiki (git submodule)
```

## Code style

- **CommonJS** throughout. Files start with `'use strict';`. Use `require`/`module.exports`.
- **Node 10+** target — uses `async`/`await`, spread, arrow functions, no ESM, no TypeScript.
- **Prettier** enforced indirectly via `.prettierrc`: 160 char width, single quotes, no bracket spacing, no trailing commas, arrow parens "avoid".
- 2-space indentation (see `.editorconfig`).
- Comma-first style is **not** used; trailing commas are forbidden.
- Adapter methods are mostly `async` and return promises.

## Architecture

- `Adapter` is the central class. Construct one per logical entity (typically per table), passing `client`, `table`, `keyFields`, and optional overrides.
- `Adapter` wraps either `AWS.DynamoDB` or `AWS.DynamoDB.DocumentClient`. It auto-detects via `typeof client.createSet == 'function'` and stores the result in `this.isDocClient`.
- All write paths funnel through `make*()` builders (`makeGet`, `makePost`, `makePut`, `makePatch`, `makeDelete`, `makeCheck`) that return `{action, params}` batch descriptors. CRUD methods optionally call `checkConsistency()` and route through `applyTransaction()` when extra checks exist.
- Mass operations come in two flavors:
  - **Native:** use DynamoDB batch/transaction APIs for throughput (`getByKeys`, `putAll`, `deleteByKeys`, `cloneByKeys`, `moveByKeys`, `*ByParams`).
  - **Generic:** sequential, item-by-item versions prefixed `generic*` — slower but lower resource use and easier to reason about.
- `KoaAdapter` is a thin HTTP wrapper that maps Koa contexts to Adapter calls. It sets `ctx.body` / `ctx.status` and reads query parameters (`fields`, `filter`, `offset`, `limit`, `consistent`, `force`, `sort`).
- `Raw` and `DbRaw` marker classes (exposed as `Adapter.Raw` and `Adapter.DbRaw`) bypass `prepare()`/`convertTo()` so callers can feed pre-shaped items.

## User-defined extension points

Subclass or pass via the constructor `options`:

- `prepare(item, isPatch)` — transform an item before writing (add technical fields, derived columns).
- `revive(rawItem, fields)` — inverse of `prepare`; clean up after reads.
- `prepareKey(key, index)` / `restrictKey(rawKey, index)` — shape DynamoDB keys for the base table or a specific index.
- `prepareListParams(item, index)` — base params for `*All` mass operations (e.g., `IndexName`, `KeyConditionExpression`).
- `updateParams(params, options)` — last-chance hook to add conditions before any write.
- `validateItem(item, isPatch)` — async validator; throw to abort.
- `checkConsistency(batch)` — async producer of extra `make*` items to run in the same transaction.

## Key conventions

- **Zero runtime dependencies.** Anything in `package.json` `dependencies` is wrong. The `aws-sdk`, `colors`, `koa*` packages are dev-only and used by the test server.
- The package only ships `*.js`, `utils/`, `helpers/` — see `package.json` `files`. Wiki, tests, and the Postman collection are not published.
- Wiki documentation lives in the `wiki/` submodule. Page filenames use `:` and `-` (e.g., `Adapter:-CRUD-methods.md`); `Home.md` is the entry point.
- The package is published as CommonJS. `index.js` is `module.exports = require('./Adapter.js')` — consumers do `const Adapter = require('dynamodb-toolkit')`.
- `searchablePrefix` defaults to `-search-`; `prepare()` typically writes `-search-<field>` lowercase copies for substring filtering.
- `'-t'` and `'-search-*'` are the conventional technical-field prefixes used in tests; not enforced by the library, but `revive()` examples in the wiki strip the leading `-`.
