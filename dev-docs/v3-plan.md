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

- [ ] **`src/rest-core/`** — parsers (`parseFields`, `parseSort`, `parseFilter`, `parsePatch`, `parseNames`, `parsePaging`), builders (`buildEnvelope`, `buildErrorBody`, `paginationLinks`), policy defaults. Unit tests for each parser and builder.
- [ ] **`src/handler/`** — `node:http` request handler wiring `rest-core` to `(req, res) =>`. Standard route pack (§7.3). Error mapping (§7.5). Policy knobs (§7.4).
- [ ] **End-to-end REST tests** — the 40-request Postman-era scenarios reproduced as tape-six tests: pagination envelope, field subsetting, sorting, filter-by-example, patch with `_delete`/`_separator`, clone, move, mass ops, error codes, idempotent DELETE, `-by-names` plain array. All via `withServer` + built-in `fetch` against DynamoDB Local.
- [ ] **Pagination links helper** — `paginationLinks(offset, limit, total)` returns `{prev, next}` with `null` at edges. Integrated into `buildEnvelope` when a URL builder is configured.

**Exit criteria:** REST surface matches the v2 Postman contract (adapted for v3 naming). All 40 scenarios pass. Error mapping produces correct status codes.

---

## Phase 6: Documentation and release

- [ ] **v3 wiki pages** — write on a scratch branch of the wiki repo. Cover: getting started, Adapter API, expressions, batch/mass ops, REST layer, hooks, migration guide, SDK v2→v3 cheat sheet.
- [ ] **Wiki cutover** — tag `v2.3-docs`, replace `main` with v3 pages, update `Home.md` pointer.
- [ ] **Bump wiki submodule** in the main repo.
- [ ] **Remove v2 code** — delete top-level `Adapter.js`, `index.js`, `helpers/`, `utils/`, `tests/server.js`, `tests/routes.js`, Postman collection, `tests/data.json.gz`. Keep `dev-docs/` as historical artifacts.
- [ ] **Update `package.json`** — version `3.0.0`, verify `exports` map, `files`, `engines`.
- [ ] **Update AI docs** — `AGENTS.md`, `llms.txt`, `llms-full.txt`, `CLAUDE.md` pointers. Run `ai-docs-update` skill.
- [ ] **Update `README.md`** — new API examples, v2 tag pointer, badge updates.
- [ ] **Release check** — run `release-check` skill. Verify npm tarball excludes `tests/`, `wiki/`, `dev-docs/`, AI rule files.
- [ ] **Publish** — `npm publish`, git tag `3.0.0` (bare semver, no `v` prefix — see cross-project convention), GitHub release.

**Exit criteria:** 3.0.0 published to npm. Wiki live with v3 docs. v2 docs preserved as `v2.3-docs` tag.

---

## Cross-cutting concerns (apply throughout all phases)

- **`.d.ts` sidecars written alongside each `.js` file**, not deferred. Deep generics (`Path<T>`, `Patch<T>`, `BatchDescriptor`) land in phase 2; Adapter generics (`Adapter<TItem, TKey>`) in phase 4.
- **No `any` in `.d.ts`** — use proper type shapes or `unknown`. See cross-project feedback.
- **No `node:*` imports in `src/`** — Web-standard globals only. `node:*` is fine in `tests/`.
- **Each module is independently importable** via the `exports` map. Verify with a quick `import` smoke test per phase.
- **v2 code remains in the repo** as reference until phase 6 removes it. No intermediate cleanup.
