# AGENTS.md — dynamodb-toolkit (v3)

> `dynamodb-toolkit` is a zero-runtime-dependency, opinionated, ESM-only micro-library for AWS DynamoDB. v3 builds on the AWS JS SDK v3 (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`). It ships an `Adapter` class, expression builders, batch + transaction chunking, mass operations, and a framework-agnostic REST core + `node:http` handler.

For published API docs see the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki). For the v3 design rationale and rejected alternatives see `dev-docs/v3-design.md`.

## Setup

This project uses a git submodule for the wiki:

```bash
git clone --recursive git@github.com:uhop/dynamodb-toolkit.git
cd dynamodb-toolkit
npm install
```

If you cloned without `--recursive`, run `git submodule update --init` to populate `wiki/`.

## Commands

| Command                             | What it does                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm install`                       | Install dependencies                                                                                  |
| `npm test`                          | Run unit + integration suite via tape-six (no Docker required)                                        |
| `npm run test:e2e`                  | Run end-to-end suite against DynamoDB Local (requires Docker)                                         |
| `npm run test:deno`                 | Manual — same suite under Deno (excluding `.cjs` tests)                                               |
| `npm run test:bun`                  | Manual — same suite under Bun (excluding `.cjs` tests)                                                |
| `npm run ts-test`                   | Manual — run TypeScript test files (`tests/test-*.*ts`) via tape-six (Node 22+)                       |
| `npm run ts-check`                  | Strict `tsc --noEmit` over `.ts`/`.d.ts` files                                                        |
| `npm run js-check`                  | `tsc --project tsconfig.check.json` — JS lint via type-checker (catches unused vars, undeclared refs) |
| `npm run lint` / `npm run lint:fix` | Prettier check / fix                                                                                  |

There is no separate build step. The published tarball ships `src/` as-is.

## Project structure

```
dynamodb-toolkit/
├── src/                       # Published code (ESM .js + .d.ts sidecars)
│   ├── index.js / index.d.ts  # Main entry — re-exports Adapter, Raw, raw, error class, types
│   ├── adapter/               # Adapter class, hooks defaults, transaction-upgrade dispatcher
│   ├── expressions/           # buildUpdate, addProjection, buildFilter, buildFilterByExample,
│   │                          #   buildCondition, cleanParams, cloneParams
│   ├── batch/                 # applyBatch, applyTransaction, getBatch, getTransaction, backoff
│   ├── mass/                  # paginateList, iterateList, readList(.byKeys),
│   │                          #   readOrderedListByKeys, writeList, deleteList, copyList,
│   │                          #   moveList, getTotal
│   ├── paths/                 # getPath, setPath, deletePath, applyPatch, normalizeFields,
│   │                          #   subsetObject
│   ├── rest-core/             # Framework-agnostic REST: parsers/, builders/, policy
│   ├── handler/               # node:http (req, res) handler + matchRoute + standard route pack
│   ├── raw.js / raw.d.ts      # Raw<T> bypass marker + raw() helper
│   └── sleep.js / seq.js / random.js (+ sidecars)
├── tests/
│   ├── test-*.js              # Unit + mock-based integration (default `npm test`)
│   ├── e2e/                   # End-to-end against DynamoDB Local (`npm run test:e2e`)
│   ├── helpers/               # withServer, dynamodb-local, matchCommand
│   └── fixtures/              # planets, table-schema
├── dev-docs/                  # v3 survey, design doc, implementation plan
└── wiki/                      # Published wiki — git submodule
```

The published tarball includes only `src/` plus `README.md` + `package.json` (npm defaults). Tests, AI rule files, dev-docs, and wiki stay out.

## Code style

- **ESM only** — `import` / `export`, `"type": "module"` in `package.json`. No CommonJS, no transpiler.
- **`.js` + hand-written `.d.ts` sidecars** — not true TypeScript. Both files live next to each other (`foo.js` ↔ `foo.d.ts`).
- **Node 20+** target. Also runs on the latest Bun and Deno.
- **No `node:*` runtime imports in `src/`.** Type-only `import type {...} from 'node:http'` in `.d.ts` is fine; runtime code stays portable. (`tests/` may use `node:*` freely.)
- **No `any` in `.d.ts`.** Use proper shapes or `unknown`.
- **Arrow functions + FP style preferred** for standalone helpers; classes only when long-lived state earns one (`Adapter`, `Raw`, `TransactionLimitExceededError`).
- **Prettier** enforces formatting (`.prettierrc`). Run `npm run lint:fix` before commits.
- **Default to no comments.** Add a one-line comment only when the WHY is non-obvious.
- **Two tsconfig files:** `tsconfig.json` strict (for `.d.ts` sidecars), `tsconfig.check.json` lenient + `checkJs` (catches unused vars / undeclared refs in `.js`).

## Architecture

`Adapter` is the composition root over orthogonal modules — it owns long-lived state (client, table, keyFields, hooks) but delegates real work to:

- `expressions/` for `UpdateExpression` / `ProjectionExpression` / `FilterExpression` / `ConditionExpression`.
- `batch/` for chunked `BatchWriteItem` / `TransactWriteItems` / `BatchGetItem` / `TransactGetItems` with `UnprocessedItems` retry + exponential backoff.
- `mass/` for paginated reads, mass writes, ordered batch reads.
- `paths/` for nested-path get/set/delete/patch on plain JS objects.

Each module is independently importable via the `exports` map; consumers can use them without instantiating `Adapter` if they only want low-level helpers.

Write paths funnel through `make*()` builders that return discriminated `BatchDescriptor`s — `{action: 'put'|'patch'|'delete'|'check'|'get', params}`. CRUD methods call `hooks.checkConsistency(descriptor)`; if it returns an array, the dispatcher upgrades the single op to a `TransactWriteItems` call. Throws `TransactionLimitExceededError` when the combined batch exceeds `TRANSACTION_LIMIT` (100).

`indirectIndices` marks GSIs that project keys only — reads against those automatically do a second-hop `BatchGetItem` against the base table via `readOrderedListByKeys`.

`Raw<T>` is the only bypass marker (the v2 `Raw` / `DbRaw` pair collapsed). `raw(item)` wraps; `instanceof Raw` detects. On writes a `Raw<T>` skips `prepare` and `validateItem`. On reads with `{reviveItems: false}`, results come back wrapped in `Raw<T>`.

## User-defined extension points

Pass via the constructor `options.hooks` or override the corresponding methods on a subclass:

| Hook                                | Default                         | When called                                                                     |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `prepare(item, isPatch?)`           | identity                        | Before every write to add technical fields, derived columns, search mirrors     |
| `prepareKey(key, index?)`           | identity                        | Before every key-only operation; default keeps just `keyFields`                 |
| `prepareListInput(example, index?)` | `() => ({})`                    | Provides extra DynamoDB params for list/scan/query (KeyCondition, IndexName, …) |
| `updateInput(input, op)`            | identity                        | Last-chance hook to mutate the SDK Command input before dispatch                |
| `revive(rawItem, fields?)`          | `subsetObject(rawItem, fields)` | After every read; strips technical fields, applies field subsetting             |
| `validateItem(item, isPatch?)`      | `async () => {}`                | Async validator; throw to abort the write                                       |
| `checkConsistency(batch)`           | `async () => null`              | Returns extra `make*` descriptors to bundle in the same `TransactWriteItems`    |

## Critical rules

- **Zero runtime dependencies.** Anything in `package.json` `dependencies` is wrong. The SDK is a `peerDependencies` entry; `tape-six` / `prettier` / `typescript` / `@types/node` / `@aws-sdk/*` (for local dev) are `devDependencies`.
- **Do not modify `wiki/`** unless explicitly asked — it's a separate git submodule.
- **Do not add or remove comments** unless explicitly asked.
- **Do not introduce a build step, transpiler, or bundler.** The package ships source as-is.
- **Do not import from `aws-sdk` (v2) anywhere.** v3 is built exclusively on `@aws-sdk/*`.
- **Do not import `node:*` modules at runtime in `src/`.** Type-only imports in `.d.ts` are fine. Tests may use `node:*` freely.

## Testing posture

- **Unit + integration (`npm test`)** uses tape-six with `node:test`'s `mock` API on `DynamoDBDocumentClient.prototype.send`. No Docker required. Covers expression builders, paths, batch/mass logic, Adapter CRUD via mocks.
- **End-to-end (`npm run test:e2e`)** spawns `amazon/dynamodb-local` via Docker, creates a randomly-suffixed table, exercises the full Adapter + REST handler against the real engine, then tears down. Skips gracefully when Docker is unavailable. The script bakes in `TAPE6_WORKER_START_TIMEOUT=60000` to allow Docker startup.
- **No third-party HTTP testing libs.** REST e2e uses `tests/helpers/withServer.js` (a 20-line `node:http` lifecycle helper) plus the built-in `fetch`.

## When reading the codebase

- `dev-docs/v3-design.md` is the authoritative design doc — read it first for rationale.
- `dev-docs/v3-survey.md` enumerates every v2 capability with an SDK v3 verdict.
- `dev-docs/v3-plan.md` tracks implementation phases and exit criteria.
- `src/adapter/adapter.js` is the composition root — read it before touching CRUD or mass ops.
- `src/handler/handler.js` is the standard REST route pack — see for the URL contract.
- `src/expressions/` is where `UpdateExpression` / `FilterExpression` / `ConditionExpression` building lives; `update.js` documents the patch + array-op semantics.
- The wiki at https://github.com/uhop/dynamodb-toolkit/wiki has the published API reference (and a `v2.3-docs` git tag preserves the v2 documentation).
