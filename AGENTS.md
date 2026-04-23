# AGENTS.md — dynamodb-toolkit (v3)

> `dynamodb-toolkit` is a zero-runtime-dependency, opinionated, ESM-only micro-library for AWS DynamoDB. v3 builds on the AWS JS SDK v3 (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`). It ships an `Adapter` class with a **declarative schema** (composite `keyFields` + `structuralKey`, `indices`, `typeLabels`/`typeDiscriminator`/`typeField`, `technicalPrefix`, `filterable`, `searchable`, `versionField`, `createdAtField`, `relationships`, `descriptorKey`), expression builders, batch + transaction helpers with cancellation-reason introspection, resumable mass operations with cascade primitives, optimistic concurrency + scope-freeze, symmetric marshallers, a framework-agnostic REST core, a `node:http` handler, and table-provisioning helpers + CLI.

For published API docs see the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki). For the v3 design rationale and rejected alternatives see `dev-docs/v3-design.md` (and `dev-docs/hierarchical-use-case.md` + `dev-docs/plan-3.7.0.md` for the 3.2→3.7 design-cleanup round).

## Setup

This project uses a git submodule for the wiki:

```bash
git clone --recursive git@github.com:uhop/dynamodb-toolkit.git
cd dynamodb-toolkit
npm install
```

If you cloned without `--recursive`, run `git submodule update --init` to populate `wiki/`.

## Commands

| Command                             | What it does                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm install`                       | Install dependencies                                                                                   |
| `npm test`                          | Run unit + integration suite via tape-six on Node (no Docker required)                                 |
| `npm run test:e2e`                  | Run end-to-end suite against DynamoDB Local (requires Docker)                                          |
| `npm run test:deno`                 | Manual — same suite under Deno (excluding `.cjs` tests)                                                |
| `npm run test:bun`                  | Manual — same suite under Bun (excluding `.cjs` tests)                                                 |
| `npm run ts-test`                   | Manual — run TypeScript test files (`tests/test-*.*ts`) via tape-six's native `.ts` support (Node 22+) |
| `npm run ts-check`                  | Strict `tsc --noEmit` over `.ts` / `.d.ts` files                                                       |
| `npm run js-check`                  | `tsc --project tsconfig.check.json` — JS lint via type-checker (catches unused vars, undeclared refs)  |
| `npm run lint` / `npm run lint:fix` | Prettier check / fix                                                                                   |
| `npx dynamodb-toolkit <subcommand>` | CLI wrapper over the `/provisioning` helpers: `plan-table` / `ensure-table` / `verify-table`           |

There is no separate build step. The published tarball ships `src/` + `bin/` as-is.

## Project structure

```
dynamodb-toolkit/
├── src/                             # Published code (ESM .js + .d.ts sidecars)
│   ├── index.js / index.d.ts        # Main entry — re-exports Adapter, Raw, raw,
│   │                                #   stampCreatedAtISO, stampCreatedAtEpoch,
│   │                                #   TransactionLimitExceededError + the 8 domain errors,
│   │                                #   sleep / seq / random, type surfaces
│   ├── adapter/                     # Adapter class, hooks composition + built-in
│   │                                #   prepare/revive/prepareKey steps, transaction-upgrade dispatcher
│   ├── expressions/                 # buildUpdate, addProjection, buildSearch,
│   │                                #   buildFilterByExample, buildCondition,
│   │                                #   buildKeyCondition, cleanParams, cloneParams
│   ├── batch/                       # applyBatch, applyTransaction, explainTransactionCancellation,
│   │                                #   getBatch, getTransaction, backoff, TRANSACTION_LIMIT
│   ├── mass/                        # paginateList, iterateList, iterateItems, readList,
│   │                                #   readListGetItems, readByKeys, writeItems, deleteByKeys,
│   │                                #   deleteList, copyList, moveList, getTotal, encodeCursor,
│   │                                #   decodeCursor, mergeMapFn, runPaged
│   │                                #   (legacy aliases: readListByKeys, readOrderedListByKeys,
│   │                                #    deleteListByKeys, writeList — warnOnce, removed in a future minor)
│   ├── paths/                       # getPath, setPath, deletePath, applyPatch,
│   │                                #   normalizeFields, subsetObject
│   ├── rest-core/                   # Framework-agnostic REST: parsers/, builders/, policy
│   │                                #   Parsers: parseFields, parseSort, parseFilter (Option W),
│   │                                #   parseSearch, parsePatch, parseNames, parsePaging,
│   │                                #   parseFlag, coerceStringQuery
│   │                                #   Builders: buildEnvelope, buildErrorBody, paginationLinks,
│   │                                #   buildListOptions, resolveSort, stripMount, validateWriteBody
│   ├── handler/                     # node:http (req, res) handler + matchRoute + readJsonBody
│   ├── hooks/                       # stampCreatedAtISO / stampCreatedAtEpoch prepare-hook factories
│   ├── marshalling/                 # Marshaller<TRuntime, TStored> pairs: dateISO, dateEpoch, url
│   │                                #   + marshallMap / unmarshallMap for Map ⇔ plain object
│   ├── provisioning/                # planTable, ensureTable, verifyTable, diffTable,
│   │                                #   descriptor helpers (buildDescriptorSnapshot, readDescriptor, writeDescriptor),
│   │                                #   lower-level primitives (buildCreateTableInput, planAddOnly, describeTable)
│   ├── errors.js / errors.d.ts      # ToolkitError base + domain subclasses
│   ├── raw.js / raw.d.ts            # Raw<T> bypass marker + raw() helper
│   └── sleep.js / seq.js / random.js (+ sidecars)
├── bin/
│   └── dynamodb-toolkit.js          # CLI wrapper — plan-table / ensure-table / verify-table
├── tests/
│   ├── test-*.js                    # Unit + mock-based integration (default `npm test`)
│   ├── test-*.cjs                   # `require('dynamodb-toolkit')` smoke (Node-only)
│   ├── test-typed.ts                # Consumer-facing typings smoke (ts-test)
│   ├── e2e/                         # End-to-end against DynamoDB Local (`npm run test:e2e`)
│   ├── helpers/                     # withServer, dynamodb-local, matchCommand, makeMockClient
│   └── fixtures/                    # planets, table-schema
├── examples/
│   └── car-rental/                  # Runnable hierarchical-use-case walkthrough (`.js` + `.ts` mirror)
├── dev-docs/                        # v3 survey, design docs, hierarchical-use-case, plan-3.7.0,
│                                    #   ergonomics-review, car-rental-feedback
└── wiki/                            # Published wiki — git submodule
```

The published tarball ships **`src/`, `bin/`, `README.md`, `LICENSE`, `llms.txt`, `llms-full.txt`, `package.json`**. Tests, AI rule files, dev-docs, examples, and wiki stay out (verify via `npm pack --dry-run`).

## Code style

- **ESM only** — `import` / `export`, `"type": "module"` in `package.json`. No CommonJS, no transpiler.
- **`.js` + hand-written `.d.ts` sidecars** — not true TypeScript. Both files live next to each other (`foo.js` ↔ `foo.d.ts`). Every exported symbol carries JSDoc on the `.d.ts` side for IDE hover.
- **Node 20+** target. Also runs on the latest Bun and Deno.
- **No `node:*` runtime imports in `src/`.** Type-only `import type {...} from 'node:http'` in `.d.ts` is fine; runtime code stays portable. (`tests/` and `bin/` may use `node:*` freely.)
- **No `any` in `.d.ts`.** Use proper shapes or `unknown`.
- **Arrow functions + FP style preferred** for standalone helpers; classes only when long-lived state earns one (`Adapter`, `Raw`, error classes).
- **Prettier** enforces formatting (`.prettierrc`). Run `npm run lint:fix` before commits.
- **Default to no comments.** Add a one-line comment only when the WHY is non-obvious.
- **Two tsconfig files:** `tsconfig.json` strict (for `.d.ts` sidecars), `tsconfig.check.json` lenient + `checkJs` (catches unused vars / undeclared refs in `.js`).
- **Pre-increment when the value is discarded** (`++i` / `--i` not `i++` / `i--`). Cross-project style rule.
- **GIGO, no runtime arg-shape validation.** TS is the contract; JS fails naturally when violated. Don't add `typeof x !== 'function'` guards for TS-typed arguments.

## Architecture

`Adapter` is the composition root over orthogonal modules. It owns long-lived state (client, table, declarative schema, hooks) but delegates real work to the sub-exports.

### Declarative schema (3.2–3.7)

Beyond `{client, table, keyFields}`, an Adapter declaration can include:

- **Composite keys** — `keyFields: [{name, type, width?}, ...]` + `structuralKey: {name, separator?}`. Built-in `prepare` composes the joined sort-key attribute; built-in `prepareKey` composes it on the read path. `width` is required on `{type: 'number'}` components in a composite (zero-padding preserves lexicographic order).
- **Indices** — `indices: {<name>: {type: 'gsi'|'lsi', pk?, sk?, projection?, sparse?, indirect?}}`. Supersedes the legacy `indirectIndices` shorthand (which is still accepted and normalised into the same shape). `sparse: true | {onlyWhen}` declares sparse-by-absence; `indirect: true` triggers the toolkit's second-hop `BatchGetItem` pattern on keys-only GSIs.
- **Type tags** — `typeLabels: [...]`, `typeDiscriminator: 'kind'`, `typeField: 'kind'`. `adapter.typeOf(item)` resolves via discriminator → depth-based label → depth number. `typeField` + built-in prepare auto-stamps `typeOf(item)` on every full write.
- **Technical prefix** — `technicalPrefix: '_'`. Built-in `prepare` rejects user items that intrude into the prefixed namespace; built-in `revive` strips prefixed fields (except `versionField` / `createdAtField` which round-trip).
- **Filterable allowlist** — `filterable: {<field>: [...ops]}` or `{<field>: {ops, type}}`. `adapter.applyFilter(params, clauses)` compiles parsed `<op>-<field>=<value>` URL clauses, auto-promoting index-compatible clauses (`eq` on pk; `eq`/`beg`/`btw`/`lt`/`le`/`gt`/`ge` on sk) to `KeyConditionExpression`.
- **Searchable mirrors** — `searchable: {field: 1}` + `searchablePrefix: '_search-'`. Built-in `prepare` writes `<prefix>field = lowercase(value)` on every write; `?search=X` at the REST layer runs a substring filter over the mirrors.
- **Optimistic concurrency** — `versionField: '_v'`. Auto-init to `1` on `post`, auto-bump on every write, auto-condition on `put`/`patch`/`edit` (via `expectedVersion` option). Mass-op `editListByParams` buckets CCF-on-version-mismatch into `MassOpResult.conflicts`.
- **Scope-freeze** — `createdAtField: '_createdAt'`. Enables `options.asOf: Date|string|number` on mass ops, AND-merging `<field> <= :asOf` into the scan FilterExpression. Toolkit does NOT auto-write the field — wire `stampCreatedAtISO` / `stampCreatedAtEpoch` from `/hooks` into user `prepare`.
- **Cascade** — `relationships: {structural: true}` gates `deleteAllUnder` / `cloneAllUnder[By]` / `moveAllUnder[By]`. Leaf-first / root-first / two-phase-idempotent pagination via shared mass-op envelope.
- **Descriptor record** — `descriptorKey: '__adapter__'`. Provisioning writes a JSON snapshot of the declaration at this reserved row; `verifyTable` diffs it for drift that `DescribeTable` can't see. Auto-filtered from list ops.

Every declarative option is opt-in and additive. An Adapter with none of them behaves exactly like the pre-3.2 line (single pk, identity hooks, no built-in steps).

### Modules

- `expressions/` — `UpdateExpression` / `ProjectionExpression` / `FilterExpression` / `ConditionExpression` / `KeyConditionExpression`. Each builder allocates per-prefix counter-based aliases (`#upk`/`:upv`, `#kc`/`:kcv`, `#cd`/`:cdv`, `#sr`/`:flt`, `:fbe`, `#pj`, `#ff`/`:ffv`) so composing builders on the same `params` is collision-safe.
- `batch/` — chunked `BatchWriteItem` (25/call), single `TransactWriteItems` (100/call), `BatchGetItem` (100/call), `TransactGetItems`. `explainTransactionCancellation` maps `CancellationReasons` back to input descriptors for debugging. `backoff(from=50, to=20_000, finite?)` — AWS "stop around one minute" default.
- `mass/` — paginated reads, bulk-individual reads/writes/deletes (caller-supplied-set), list-op reads/writes/deletes (DB-produces-set). Resumable list-op variants return `MassOpResult` with `{processed, skipped, failed, conflicts, cursor?}`. Category-driven naming: "List" in a helper name means DB-produces-set; bulk-individual helpers drop "List".
- `paths/` — nested-path get/set/delete/patch on plain JS objects. Prototype-safe (rejects `__proto__` / `constructor` / `prototype` segments).
- `rest-core/` — REST primitives (parsers + builders + policy). DoS-gated: `parsePaging.maxOffset` (100k default), `parseFields/Names.maxItems` (1000), `parseSearch.maxLength` (1024), `validateWriteBody` for `{...body, ...key}` safety, null-prototype accumulators throughout. `parseFilter` (Option W): `?<op>-<field>=<value>`; ops `eq ne lt le gt ge in btw beg ct ex nx`; multi-value ops use first-char delimiter.
- `handler/` — `node:http` `(req, res) =>` handler on top of rest-core. `HEAD → GET` auto-promote, byte-accurate `maxBodyBytes` (default 1 MiB), `readJsonBody` with streaming TextDecoder (~1× body size peak memory).
- `hooks/` — `stampCreatedAtISO` / `stampCreatedAtEpoch` prepare-hook factories (first-insert only; patches and round-tripped reads untouched).
- `marshalling/` — `Marshaller<TRuntime, TStored>` pairs. `dateISO`, `dateEpoch`, `url`, plus `marshallMap` / `unmarshallMap` for `Map` ⇔ plain object. Undefined / null pass through everywhere.
- `provisioning/` — ADD-only table lifecycle. `planTable` (read-only plan), `ensureTable` (plan + apply), `verifyTable` (diff + optional throw), descriptor read/write. IaC-agnostic: absent descriptor is neutral by default.

Each module is independently importable via the `exports` map; consumers can use them without instantiating `Adapter`.

### Write-path invariants

- **Every single-op write funnels through `dispatchWrite(client, batch, checks)`** (`src/adapter/transaction-upgrade.js`). Build descriptor → `hooks.checkConsistency(batch)` → `null` means single-Command fast path; any array (even `[]`) upgrades to `TransactWriteItems` with the main op plus the returned descriptors. Combined count > `TRANSACTION_LIMIT` (100) → `TransactionLimitExceededError`.
- **Every `make*` builder returns a discriminated `BatchDescriptor`** — `{action: 'get'|'check'|'put'|'patch'|'delete', params}` (plus `adapter` on `makeGet`). Compose with `applyTransaction` / `applyBatch` / `getBatch` / `getTransaction`.
- **Built-in prepare/revive/prepareKey steps** run before user hooks when the relevant declarative options are set — see the Declarative schema section above.

### Read-path invariants

- **Indirect indices** (`indices[*].indirect: true` on a keys-only GSI) — reads Query the GSI for base-table keys, then `BatchGetItem` the base table with the caller's `fields` projection. Per-call opt-out via `{ignoreIndirection: true}`.
- **`adapter.buildKey(values, {self?, partial?}?, params?)`** — ergonomic `KeyConditionExpression` builder for hierarchical queries. Default children-only; `{self: true}` adds the row at `values`; `{partial: 'X'}` narrows the next tier. Composite `keyFields` + `structuralKey` required for `{self}` / `{partial}`. `{indexName}` reserved for future declarative-GSI surface (throws today).
- **`Raw<T>`** is the bypass marker. On writes a `Raw<T>` skips built-in prepare + user `prepare` + `validateItem`. On reads with `{reviveItems: false}`, results come back wrapped in `Raw<T>`.

### Errors

All domain errors extend `ToolkitError` (which extends `Error`). `err.name` matches the class name for non-`instanceof` discrimination. Some errors carry `.status` which short-circuits the REST handler's error mapping.

- `ConsistentReadOnGSIRejected` — `ConsistentRead: true` on a GSI (DynamoDB rejects).
- `NoIndexForSortField` — `?sort=<field>` has no matching declared index (toolkit does not in-memory-sort).
- `BadFilterField` / `BadFilterOp` — `<op>-<field>=` rejected at the allowlist.
- `KeyFieldChanged` — `edit()` mapFn touched a keyField without `{allowKeyChange: true}`.
- `CreatedAtFieldNotDeclared` — `asOf` used without `createdAtField`.
- `CascadeNotDeclared` — cascade primitive called without `relationships.structural`.
- `TableVerificationFailed` — `verifyTable({throwOnMismatch})` detected drift.
- `TransactionLimitExceededError` — auto-upgraded transaction > 100 actions.

## User-defined extension points

Pass via the constructor `options.hooks` or override the corresponding methods on a subclass. User hooks compose **around** the built-in steps — the built-in runs first, the user hook sees its output.

| Hook                                | Default                         | When called                                                                                                              |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `prepare(item, isPatch?)`           | identity                        | Before every non-`Raw` write. Built-in step (mirrors, structural key, typeField, version init) runs first.               |
| `prepareKey(key, index?)`           | identity                        | Before every keyed op. Built-in step (compose structural key from `keyFields`) runs first.                               |
| `prepareListInput(example, index?)` | `() => ({})`                    | Provides extra DynamoDB params for list/scan/query (KeyCondition, IndexName, …)                                          |
| `updateInput(input, op)`            | identity                        | Last-chance hook to mutate the SDK Command input before dispatch                                                         |
| `revive(rawItem, fields?)`          | `subsetObject(rawItem, fields)` | After every read. Built-in step (strip `technicalPrefix` fields; preserve `versionField` / `createdAtField`) runs first. |
| `validateItem(item, isPatch?)`      | `async () => {}`                | Async validator; throw to abort the write. Skipped for `Raw<T>` items.                                                   |
| `checkConsistency(batch)`           | `async () => null`              | Returns extra `make*` descriptors to bundle in the same `TransactWriteItems`                                             |

## Critical rules

- **Zero runtime dependencies.** Anything in `package.json` `dependencies` is wrong. The SDK is a `peerDependencies` entry; `tape-six` / `prettier` / `typescript` / `@types/node` / `@aws-sdk/*` (for local dev) are `devDependencies`.
- **Do not modify `wiki/`** unless explicitly asked — it's a separate git submodule. When asked, work on a feature branch inside the submodule; Eugene commits primary-branch history manually.
- **Do not self-commit to master / main** unless explicitly asked. Stage + report; Eugene commits.
- **Do not add or remove comments** unless explicitly asked.
- **Do not introduce a build step, transpiler, or bundler.** The package ships source as-is.
- **Do not import from `aws-sdk` (v2) anywhere.** v3 is built exclusively on `@aws-sdk/*`.
- **Do not import `node:*` modules at runtime in `src/`.** Type-only imports in `.d.ts` are fine. Tests and `bin/` may use `node:*` freely.
- **Run the full check matrix before claiming work is ready.** `npm run lint && npm run ts-check && npm run js-check && npm test && npm run test:bun && npm run test:deno` + `npm run ts-test`.

## Testing posture

- **Unit + integration (`npm test`)** uses tape-six with `node:test`'s `mock` API on `DynamoDBDocumentClient.prototype.send`. No Docker required. Covers expression builders, paths, batch/mass logic, Adapter CRUD via mocks.
- **End-to-end (`npm run test:e2e`)** spawns `amazon/dynamodb-local` via Docker, creates a randomly-suffixed table, exercises the full Adapter + REST handler + cascade primitives + provisioning against the real engine, then tears down. Skips gracefully when Docker is unavailable. The script bakes in `TAPE6_WORKER_START_TIMEOUT=60000` to allow Docker startup.
- **Cross-runtime parity (`npm run test:bun` / `:deno`)** — same `.js` / `.mjs` suite, excludes `.cjs` smoke tests (CommonJS-from-ESM-sibling semantics differ by runtime). Node's count exceeds Bun/Deno by the `.cjs` test delta — expected.
- **Typed smoke test (`npm run ts-test`)** runs `tests/test-*.*ts` via tape-six's native `.ts` support (Node 22+ or Bun/Deno). Verifies consumer-facing typings still compile and execute against the published `.d.ts` sidecars.
- **No third-party HTTP testing libs.** REST e2e uses `tests/helpers/withServer.js` (a 20-line `node:http` lifecycle helper) plus the built-in `fetch`.
- **`t.throws` second arg must be a plain string.** `tape-six` reporter crashes on regex / constructor.

## When reading the codebase

- `dev-docs/v3-design.md` / `v3-survey.md` / `v3-plan.md` — original v3 design rationale + v2 → v3 capability map.
- `dev-docs/hierarchical-use-case.md` + `dev-docs/hierarchical-implementation-plan.md` — the 3.2→3.6 declarative-schema design round (structural key, cascade, OC, provisioning).
- `dev-docs/plan-3.7.0.md` + `dev-docs/car-rental-feedback.md` + `dev-docs/ergonomics-review-3.6.0.md` — the 3.7.0 ergonomics/design-cleanup round (filter URL grammar, `planTable`/`ensureTable` split, `buildKey` simplification, `typeField` auto-populate).
- `src/adapter/adapter.js` — composition root. Read before touching CRUD, mass ops, built-in prepare/revive, or transaction-upgrade flows.
- `src/adapter/transaction-upgrade.js` — `dispatchWrite` single-Command vs `TransactWriteItems` auto-upgrade.
- `src/handler/handler.js` — `node:http` route pack + request/response shape. `src/handler/match-route.js` — route matching with HEAD→GET auto-promote.
- `src/expressions/` — expression builders. Start with `update.js` (patch + arrayOps), `condition.js` (declarative clause AST), `key-condition.js` (KCE primitive).
- `src/mass/` — start with `paginate-list.js`, `run-paged.js`, `cursor.js` for the resumable envelope.
- `src/rest-core/parsers/parse-filter.js` — Option W grammar.
- `src/provisioning/ensure-table.js` + `descriptor.js` — table lifecycle + schema snapshot.
- `bin/dynamodb-toolkit.js` — CLI wrapper over `planTable` / `ensureTable` / `verifyTable`.
- `examples/car-rental/` — runnable hierarchical-use-case walkthrough. Matches the wiki recipe book (Recipes index + per-pattern pages).
- Wiki at https://github.com/uhop/dynamodb-toolkit/wiki — published API reference (and a `v2.3-docs` git tag preserves the v2 documentation). Start at Home → Concepts → Key-and-field-design → Recipes.
