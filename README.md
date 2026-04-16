# dynamodb-toolkit [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/dynamodb-toolkit.svg
[npm-url]: https://npmjs.org/package/dynamodb-toolkit

Opinionated zero-runtime-dependency micro-library for [AWS DynamoDB](https://aws.amazon.com/dynamodb/) — REST-shaped Adapter, expression builders, batch/transaction chunking, mass operations, and a framework-agnostic HTTP handler. Built on the AWS JS SDK v3.

> **v3 is a green-field rewrite.** v2 consumers stay on v2 (`dynamodb-toolkit@2.3.0`). The v3 API, naming, and packaging differ throughout — see [Migration: v2 → v3](#migration-v2--v3) below and the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki).

## Highlights

- **Zero runtime dependencies.** AWS SDK v3 modules are peer dependencies (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`).
- **ESM-only.** Native `import` / `export`, hand-written `.d.ts` sidecars next to every `.js` file. No build step.
- **Schemaless Adapter** with hooks for `prepare` / `revive` / `validateItem` / `checkConsistency` and automatic single-op → `transactWriteItems` upgrade.
- **Expression builders** for `UpdateExpression`, `ProjectionExpression`, `FilterExpression`, `ConditionExpression` — including patch-with-options, atomic array ops, filter-by-example.
- **Batch + transaction chunking** with `UnprocessedItems` / `UnprocessedKeys` retry and exponential backoff.
- **Mass operations** — `putAll`, `deleteByKeys`, `cloneByKeys`, `moveByKeys`, paginated reads with offset+limit accumulation through `FilterExpression`.
- **Indirect-index second-hop** for sparse GSIs with key-only projection.
- **Framework-agnostic REST core + `node:http` handler** — pure parsers/builders/policy plus a standard route pack ready to drop into `createServer`.

## Install

```sh
npm install dynamodb-toolkit @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

Requires Node 20 or newer (also works on the latest Bun and Deno).

## Quick start

```js
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {Adapter} from 'dynamodb-toolkit';

const client = new DynamoDBClient({region: 'us-east-1'});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {removeUndefinedValues: true}
});

const adapter = new Adapter({
  client: docClient,
  table: 'planets',
  keyFields: ['name'],
  searchable: {climate: 1, terrain: 1}
});

await adapter.put({name: 'Tatooine', climate: 'arid', terrain: 'desert'}, {force: true});

const planet = await adapter.getByKey({name: 'Tatooine'});
// → {name: 'Tatooine', climate: 'arid', terrain: 'desert'}

const page = await adapter.getAllByParams({}, {offset: 0, limit: 10});
// → {data: [...], offset: 0, limit: 10, total: N}
```

## REST handler

```js
import {createServer} from 'node:http';
import {createHandler} from 'dynamodb-toolkit/handler';

const handler = createHandler(adapter, {
  sortableIndices: {name: '-t-name-index'}
});

createServer(handler).listen(3000);
```

The handler ships a standard route pack — `GET / POST /`, `GET PUT PATCH DELETE /:key`, `GET DELETE /-by-names`, `PUT /-load`, `PUT /-clone`, `PUT /-move`, `PUT /-clone-by-names`, `PUT /-move-by-names`, `PUT /:key/-clone`, `PUT /:key/-move` — with envelope keys, status codes, and prefixes all configurable via `options.policy`.

## Sub-exports

The package ships discrete, tree-shakable sub-exports for callers who want only the lower-level surface:

| Sub-export                     | What's inside                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dynamodb-toolkit`             | `Adapter`, `Raw`, `raw()`, `TransactionLimitExceededError`, type re-exports                                                                                                                               |
| `dynamodb-toolkit/expressions` | `buildUpdate`, `addProjection`, `buildFilter`, `buildFilterByExample`, `buildCondition`, `cleanParams`, `cloneParams`                                                                                     |
| `dynamodb-toolkit/batch`       | `applyBatch`, `applyTransaction`, `getBatch`, `getTransaction`, `backoff`, `TRANSACTION_LIMIT`                                                                                                            |
| `dynamodb-toolkit/mass`        | `paginateList`, `iterateList`, `iterateItems`, `readList`, `readListByKeys`, `readOrderedListByKeys`, `writeList`, `deleteList`, `deleteListByKeys`, `copyList`, `moveList`, `getTotal`                   |
| `dynamodb-toolkit/paths`       | `getPath`, `setPath`, `deletePath`, `applyPatch`, `normalizeFields`, `subsetObject`                                                                                                                       |
| `dynamodb-toolkit/rest-core`   | `parseFields`, `parseSort`, `parseFilter`, `parsePatch`, `parseNames`, `parsePaging`, `parseFlag`, `buildEnvelope`, `buildErrorBody`, `paginationLinks`, `defaultPolicy`, `mapErrorStatus`, `mergePolicy` |
| `dynamodb-toolkit/handler`     | `createHandler`, `matchRoute`                                                                                                                                                                             |

Full reference docs live in the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki).

## Migration: v2 → v3

v3 is not a drop-in upgrade. Highlights:

- **AWS SDK v3** — `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` peer-deps replace `aws-sdk`. Construct a `DynamoDBDocumentClient` and pass it as `options.client`.
- **One data format** — plain JS via `lib-dynamodb` middleware. The `Raw` / `DbRaw` distinction is gone; `Raw<T>` is now a single bypass marker (`raw(item)`).
- **Options bags everywhere** — `put(item, {force: true})` instead of `put(item, true)`; `getByKey(key, fields, {consistent: true})`; `patch(key, patch, {delete: [...]})`.
- **Hooks renamed** — `prepareListParams` → `prepareListInput`, `updateParams` → `updateInput`. The hooks bag (`options.hooks`) is the canonical extension point; subclassing still works.
- **Patch wire format** — `_delete` / `_separator` (single underscore) by default; configurable via `policy.metaPrefix`.
- **REST layer split** — `dynamodb-toolkit/rest-core` is framework-agnostic; `dynamodb-toolkit/handler` is the `node:http` adapter. Koa lives in a separate package.
- **No more `makeClient` / `getProfileName`** — use `@aws-sdk/credential-providers` (`fromIni`, `fromNodeProviderChain`) directly.

The v2 documentation snapshot lives in the wiki repo at the `v2.3-docs` git tag. The v2 source code remains available on npm as `dynamodb-toolkit@2.3.0` and on GitHub at the matching git tag.

## Status

3.x is the current actively-developed line. v2 receives no further changes.

## License

[BSD-3-Clause](LICENSE).
