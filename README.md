# dynamodb-toolkit [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/dynamodb-toolkit.svg
[npm-url]: https://npmjs.org/package/dynamodb-toolkit

Opinionated zero-runtime-dependency micro-library for [AWS DynamoDB](https://aws.amazon.com/dynamodb/) — REST-shaped Adapter, expression builders, batch/transaction chunking, mass operations, and a framework-agnostic HTTP handler. Built on the AWS JS SDK v3.

> **v3 is a green-field rewrite.** v2 consumers stay on v2 (`dynamodb-toolkit@2.3.0`). The v3 API, naming, and packaging differ throughout — see [Migration: v2 → v3](#migration-v2--v3) below and the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki).

## Highlights

- **Zero runtime dependencies.** AWS SDK v3 modules are peer dependencies (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`).
- **ESM-only.** Native `import` / `export`, hand-written `.d.ts` sidecars next to every `.js` file. No build step.
- **TypeScript, CommonJS, Node/Deno/Bun** — first-class TS typings via sidecars, CJS consumers can `require()` on current Node 20+, and the test suite runs on all three runtimes (see [Compatibility](#compatibility)).
- **Schemaless Adapter** with hooks for `prepare` / `revive` / `validateItem` / `checkConsistency` and automatic single-op → `transactWriteItems` upgrade.
- **Expression builders** for `UpdateExpression`, `ProjectionExpression`, `FilterExpression`, `ConditionExpression` — including patch-with-options, atomic array ops, filter-by-example.
- **Batch + transaction chunking** with `UnprocessedItems` / `UnprocessedKeys` retry and exponential backoff.
- **Mass operations** — `putAll`, `deleteByKeys`, `cloneByKeys`, `moveByKeys`, paginated reads with offset+limit accumulation through `FilterExpression`.
- **Indirect-index second-hop** for sparse GSIs with key-only projection.
- **Framework-agnostic REST core + `node:http` handler** — pure parsers/builders/policy plus a standard route pack ready to drop into `createServer`.

## "Toolkit", not "framework"

The pieces are independent — adopt as much or as little as you need. Every layer has a public surface and is useful on its own:

- Use `buildUpdate` / `buildCondition` to prepare a `params` object, then send it with the raw SDK `UpdateCommand`. No `Adapter` in sight.
- Hand-build your own `params` and pass them to `applyBatch` / `applyTransaction` for chunking, `UnprocessedItems` retry, and exponential backoff.
- Use the `Adapter` for CRUD + hooks, but swap in your own `@aws-sdk/lib-dynamodb` Command invocation anywhere you want raw control.
- Take the REST handler or leave it — the `Adapter` works standalone.

Two concrete payoffs: **migration** (adopt one piece at a time starting from raw-SDK code) and **debugging** (peel back layers when something looks off). The boundary between caller code and toolkit machinery stays explicit.

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

## Framework adapters

The bundled `dynamodb-toolkit/handler` is a pure `node:http` handler. Framework-specific bindings live in separate packages so the core stays zero-dep — each adapter is a thin wrapper that translates its framework's request/response shape into the toolkit's `rest-core` parsers + standard route pack. The wire contract (routes, query parameters, envelope keys, error mapping) is identical across all four.

| Package                                                                              | Runtime / framework                          | Notes                                                                                                                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`dynamodb-toolkit-koa`](https://www.npmjs.com/package/dynamodb-toolkit-koa)         | [Koa](https://koajs.com/) 2.x                | Middleware; `koa` as peer dep                                                                                                                      |
| [`dynamodb-toolkit-express`](https://www.npmjs.com/package/dynamodb-toolkit-express) | [Express](https://expressjs.com/) 4.x / 5.x  | Middleware / Router; `express` as peer dep                                                                                                         |
| [`dynamodb-toolkit-fetch`](https://www.npmjs.com/package/dynamodb-toolkit-fetch)     | Fetch API — `(Request) => Promise<Response>` | Zero-framework; runs on Cloudflare Workers, Deno Deploy, Bun.serve, Hono, Node native fetch server                                                 |
| [`dynamodb-toolkit-lambda`](https://www.npmjs.com/package/dynamodb-toolkit-lambda)   | AWS Lambda handler                           | Four event shapes (API Gateway REST / HTTP, Function URL, ALB); ships local-debug bridges for running the handler on real HTTP without `sam local` |

## Sub-exports

The package ships discrete, tree-shakable sub-exports for callers who want only the lower-level surface:

| Sub-export                     | What's inside                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dynamodb-toolkit`             | `Adapter`, `Raw`, `raw()`, `TransactionLimitExceededError`, type re-exports                                                                                                                               |
| `dynamodb-toolkit/expressions` | `buildUpdate`, `addProjection`, `buildFilter`, `buildFilterByExample`, `buildCondition`, `cleanParams`, `cloneParams`                                                                                     |
| `dynamodb-toolkit/batch`       | `applyBatch`, `applyTransaction`, `explainTransactionCancellation`, `getBatch`, `getTransaction`, `backoff`, `TRANSACTION_LIMIT`                                                                          |
| `dynamodb-toolkit/mass`        | `paginateList`, `iterateList`, `iterateItems`, `readList`, `readListByKeys`, `readOrderedListByKeys`, `writeList`, `deleteList`, `deleteListByKeys`, `copyList`, `moveList`, `getTotal`                   |
| `dynamodb-toolkit/paths`       | `getPath`, `setPath`, `deletePath`, `applyPatch`, `normalizeFields`, `subsetObject`                                                                                                                       |
| `dynamodb-toolkit/rest-core`   | `parseFields`, `parseSort`, `parseFilter`, `parsePatch`, `parseNames`, `parsePaging`, `parseFlag`, `buildEnvelope`, `buildErrorBody`, `paginationLinks`, `defaultPolicy`, `mapErrorStatus`, `mergePolicy` |
| `dynamodb-toolkit/handler`     | `createHandler`, `matchRoute`                                                                                                                                                                             |

Full reference docs live in the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki).

## Compatibility

**TypeScript.** Hand-written `.d.ts` sidecars ship next to every `.js` — no build step, no typing-generation round-trip. `Adapter<TItem, TKey>` binds the item shape to method signatures; `buildUpdate<T>` / `buildCondition<T>` preserve caller-supplied `params` typing. A typed smoke test at [`tests/test-typed.ts`](tests/test-typed.ts) exercises the consumer-facing surface; run it via `npm run ts-test` (Node 22+; tape-six runs `.ts` natively — no `tsx` / `ts-node` needed).

**CommonJS.** The package is ESM, but `require('dynamodb-toolkit')` works from `.cjs` on current Node 20+ (`require(esm)` shipped unflagged in Node 20.19 for the 20.x line and 22.12 for 22.x). No `await import()` needed — the source has no top-level `await`. A CJS smoke test at [`tests/test-smoke.cjs`](tests/test-smoke.cjs) demonstrates the main entry and every sub-export; it runs as part of `npm test` under Node.

**Runtimes.** Tested on Node, Deno, and Bun. The same source tree runs under all three — `.cjs` tests are Node-only (`require(esm)` is the Node-specific story); everything else is portable.

| Runtime | Script              |
| ------- | ------------------- |
| Node    | `npm test`          |
| Deno    | `npm run test:deno` |
| Bun     | `npm run test:bun`  |

More detail lives on the [Compatibility](https://github.com/uhop/dynamodb-toolkit/wiki/Compatibility) wiki page.

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
