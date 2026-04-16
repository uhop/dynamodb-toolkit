# dynamodb-toolkit — v3 Implementation Plan

> **Status:** approved. Tracks implementation of `dev-docs/v3-design.md`.
> **Date:** 2026-04-15.
> **Posture:** green-field rewrite. v2 code stays in the repo until v3 is complete; then v2 files are removed in the shipping commit.

---

## Phase 1: Scaffolding

Set up the project skeleton so that every subsequent phase can write code, run tests, and iterate.

- [ ] **`package.json` overhaul** — `"type": "module"`, `exports` map (§8.3 of design doc), `peerDependencies` on `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` (`^3.0.0`), `devDependencies` on `tape-six` + SDK peers, `engines.node: ">=20"`, `files: ["src"]`.
- [ ] **`src/` directory structure** — create empty folders matching §8.2: `adapter/`, `expressions/`, `batch/`, `mass/`, `paths/`, `rest-core/`, `handler/`. Bare file placeholders for `sleep.js`, `seq.js`, `random.js`. Top-level `src/index.js` + `src/index.d.ts` stubs.
- [ ] **Test infrastructure** — `tests/` directory with:
  - `tape-six` config (test script in `package.json`).
  - `tests/helpers/withServer.js` — `node:http` server lifecycle helper (design doc §9.2).
  - `tests/helpers/matchCommand.js` — SDK mock command matcher.
  - `tests/helpers/dynamodb-local.js` — Docker lifecycle for DynamoDB Local (spawn, health-check, skip-if-unavailable).
  - `tests/fixtures/planets.js` — Star Wars planets dataset (from `tests/data.json.gz`).
  - `tests/fixtures/table-schema.js` — `CreateTable` input for test tables.
- [ ] **CI stub** — GitHub Actions workflow: `npm install` → `npm test`. DynamoDB Local via `services` block. Single runner: `ubuntu-latest`, latest Node.

**Exit criteria:** `npm test` runs tape-six with zero test files and exits clean. DynamoDB Local spins up in CI.

---

## Phase 2: Foundation modules

Pure functions with no SDK dependency. Each module ships `.js` + `.d.ts` sidecar + unit tests.

- [ ] **`src/paths/`** — `getPath`, `setPath`, `deletePath`, `applyPatch`, `normalizeFields`, `subsetObject`. Port from v2 `utils/` equivalents, modernize to ESM. Tests: nested objects, array-index segments, edge cases (empty path, missing intermediate).
- [ ] **`src/expressions/`** — `buildUpdate` (patch builder + array ops), `addProjection`, `buildFilter`, `buildFilterByExample`, `buildCondition`, `cleanParams`, `cloneParams`. Port from v2 `utils/prepareUpdate.js`, `utils/addProjection.js`, `utils/filtering.js`. New: `buildCondition`, array ops (§5.2), `buildFilterByExample`. Tests: expression string correctness, attribute name/value dedup, dotted-path handling, array ops.
- [ ] **`Raw<T>` brand** — `src/raw.js` + `src/raw.d.ts`. The `raw()` helper + `Raw` class + branded type. Tests: wrapping, `instanceof` detection.
- [ ] **Bare files** — `src/sleep.js`, `src/seq.js`, `src/random.js` + `.d.ts` sidecars. Port from v2 `utils/`. Tests: basic behavior.
- [ ] **`src/index.js` + `src/index.d.ts`** — re-exports of `Raw`, `raw()`, type re-exports from SDK peers (`DynamoDBDocumentClient`, `NativeAttributeValue`, `NumberValue`).

**Exit criteria:** all expression builders, path utilities, and helpers pass unit tests. No SDK import anywhere in `src/` yet (except type-only in `.d.ts`).

---

## Phase 3: SDK interaction modules

Modules that call `DynamoDBDocumentClient.send()`. Tested with `node:test` mocks.

- [ ] **`src/batch/`** — `applyBatch`, `applyTransaction`, `getBatch`, `getTransaction`, `backoff`. Port from v2 `utils/apply*.js`, `utils/get*.js`, `utils/backoff.js`. Key changes: transaction chunk limit 25 → 100, `UnprocessedItems` retry loop preserved. Tests (mock): normal path, partial-unprocessed retry, backoff timing, chunk splitting.
- [ ] **`src/mass/`** — `writeList`, `deleteList`, `copyList`, `moveList`, `readList` family + `byKeys`/`byParams` variants. `paginateList` (offset/limit with filter accumulation), `paginateListNoLimit`, `iterateList` (async iterator), `readOrderedListByKeys` (order preservation). Port from v2 `utils/*List.js`, `utils/paginate*.js`, `utils/iterateList.js`, `utils/readOrderedListByKeys.js`. Key changes: `strategy: 'native' | 'sequential'` replaces `generic*` siblings; `needTotal` plumbed through. Tests (mock): pagination with short pages, filter accumulation, order preservation, strategy switching.

**Exit criteria:** batch and mass operations pass integration tests against mocked `send()`. `UnprocessedItems` retry loop and pagination accumulation verified.

---

## Phase 4: Adapter

The composition root that ties foundation + SDK modules + hooks together.

- [x] **`src/adapter/adapter.js` + `.d.ts`** — `class Adapter<TItem, TKey>`. Constructor takes `AdapterOptions` (§4.2). CRUD surface (§4.3): `getByKey`, `getByKeys`, `getAll`, `getAllByParams`, `post`, `put`, `patch`, `delete`, `clone`, `move`, mass ops (`putAll`, `deleteByKeys`, `deleteAllByParams`, `cloneByKeys`, `cloneAllByParams`, `moveByKeys`, `moveAllByParams`), batch builders (`makeGet`, `makeCheck`, `makePost`, `makePut`, `makePatch`, `makeDelete`).
- [x] **`src/adapter/hooks.js`** — default hook implementations. `prepare`/`revive`/`prepareKey`/`prepareListInput`/`updateInput`/`validateItem`/`checkConsistency`.
- [x] **`src/adapter/transaction-upgrade.js`** — `checkConsistency` → `transactWriteItems` auto-upgrade logic. `TransactionLimitExceededError` thrown when batch+checks > 100.
- [x] **Indirect indices** — second-hop `BatchGetItem` via `readOrderedListByKeys` when `indirectIndices[indexName]` is set.
- [x] **Integration tests (mock)** — Adapter CRUD through mocked `send()`: single ops, mass ops, transaction auto-upgrade, indirect-index second-hop, hook invocation order, `reviveItems: false`, `Raw<T>` bypass. 32 tests / 78 asserts.
- [x] **End-to-end tests (DynamoDB Local)** — Adapter CRUD against real DynamoDB Local: full lifecycle (create table → load planets → read/write/patch/delete → verify). 18 tests / 36 asserts. Skips gracefully when Docker is unavailable. `npm run test:e2e`.

**Exit criteria:** all Adapter methods work against DynamoDB Local. Transaction auto-upgrade, indirect indices, and hooks verified end-to-end. ✓

---

## Phase 5: REST layer

Framework-agnostic core + `node:http` handler. Tested end-to-end against DynamoDB Local.

- [x] **`src/rest-core/`** — parsers (`parseFields`, `parseSort`, `parseFilter`, `parsePatch`, `parseNames`, `parsePaging`, `parseFlag`), builders (`buildEnvelope`, `buildErrorBody`, `paginationLinks`), policy defaults + `mapErrorStatus` + `mergePolicy`. 51 unit tests.
- [x] **`src/handler/`** — `node:http` request handler wiring `rest-core` to `(req, res) =>`. Standard route pack: GET/POST/DELETE on `/`, GET/PUT/PATCH/DELETE on `/:key`, `-by-names`, `-load`, `-clone`, `-move`, `:key/-clone`, `:key/-move`, `-clone-by-names`, `-move-by-names`. Error mapping: ConditionalCheckFailed→409, Validation→422, throughput→429, 5xx SDK→503. Policy knobs (envelope keys, status codes, prefixes, paging defaults).
- [x] **End-to-end REST tests** — 19 tape-six scenarios via `withServer` + built-in `fetch` against DynamoDB Local: pagination envelope w/ links, field subsetting, sort + filter, patch with `_delete`, clone-by-names with body overlay, error mapping (404/405/409/422), idempotent DELETE, `-by-names` plain array.
- [x] **Pagination links helper** — `paginationLinks(offset, limit, total, urlBuilder)` returns `{prev, next}` with `null` at edges. Integrated into `buildEnvelope` when `links` option is supplied.

**Exit criteria:** REST surface matches the v2 Postman contract (adapted for v3 naming). 19 e2e scenarios pass. Error mapping produces correct status codes. ✓

---

## Phase 6: Documentation and release

- [x] **v3 wiki pages** — drafted on `v3-docs` scratch branch of the wiki submodule (22 pages). NOT pushed; awaiting cutover.
- [ ] **Wiki cutover** (USER) — tag `v2.3-docs` from current wiki `main`, replace `main` with `v3-docs`, push both.
- [ ] **Bump wiki submodule** (USER) — in the main repo, in the same PR that ships v3.
- [x] **Remove v2 code** — top-level `Adapter.js`, `index.js`, `ARCHITECTURE.md`, `helpers/`, `utils/`, `prompts/`, `tests/server.js`, `tests/routes.js`, `tests/data.json.gz`, Postman collection. `dev-docs/` retained as historical artifacts.
- [x] **Update `package.json`** — version `3.0.0`, exports map verified (7 entries), `files: ["src"]`, `engines.node: ">=20"`, peer deps on `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` `^3.0.0`.
- [x] **Update AI docs** — `AGENTS.md`, `llms.txt`, `llms-full.txt` rewritten for v3. `CLAUDE.md` and `.github/COPILOT-INSTRUCTIONS.md` already point at AGENTS.md. `.cursorrules` / `.windsurfrules` / `.clinerules` byte-identical (rewritten + synced).
- [x] **Update `README.md`** — new install + quick-start examples, REST handler example, sub-export table, migration callout, v2 tag pointer.
- [x] **Release check** — `npm pack --dry-run` ships only `src/` + `README.md` + `package.json` (106 files / 28.4 kB). All tests + ts-check + js-check + prettier pass.
- [ ] **Publish** (USER) — `npm publish`, git tag `3.0.0` (bare semver, no `v` prefix), GitHub release.

**Exit criteria:** 3.0.0 published to npm. Wiki live with v3 docs. v2 docs preserved as `v2.3-docs` tag.

---

## Cross-cutting concerns (apply throughout all phases)

- **`.d.ts` sidecars written alongside each `.js` file**, not deferred. Deep generics (`Path<T>`, `Patch<T>`, `BatchDescriptor`) land in phase 2; Adapter generics (`Adapter<TItem, TKey>`) in phase 4.
- **No `any` in `.d.ts`** — use proper type shapes or `unknown`. See cross-project feedback.
- **No `node:*` imports in `src/`** — Web-standard globals only. `node:*` is fine in `tests/`.
- **Each module is independently importable** via the `exports` map. Verify with a quick `import` smoke test per phase.
- **v2 code remains in the repo** as reference until phase 6 removes it. No intermediate cleanup.
