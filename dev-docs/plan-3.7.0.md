# dynamodb-toolkit 3.7.0 — implementation plan

> **Source of decisions.** `dev-docs/car-rental-feedback.md` (F1–F10 + E1–E6); `dev-docs/ergonomics-review-3.6.0.md` (prior E-round). Nothing in this plan is a new design — it sequences already-approved items.
>
> **Principle (from feedback doc).** Break straight through. No deprecation shims. 4.0 held for when the API stabilizes.
>
> **Test posture.** Every phase ends with full checks green: `prettier`, `ts-check`, `js-check`, all three runtimes (Node / Bun / Deno). Tests updated in-phase — no cross-phase regressions carried forward. Commit at the end of each phase; publish only at 3.7.0-ready.

## Phase 1 — Naming + grammar cascade (F5 + Q9 + Q10)

Land first because every downstream phase references the renamed symbols. Single largest mechanical phase.

**Filename swap** (dependency-ordered):

1. `git mv src/rest-core/parsers/parse-filter.{js,d.ts} src/rest-core/parsers/parse-search.{js,d.ts}`
2. `git mv src/rest-core/parsers/parse-f-filter.{js,d.ts} src/rest-core/parsers/parse-filter.{js,d.ts}`

**Parser rewrite** (`parse-filter.js`, new content from old `parse-f-filter.js`):

- Grammar → Option W: `/^(eq|ne|lt|le|gt|ge|in|btw|beg|ct|ex|nx)-(.+)$/`
- Left-anchored split; field is the capture-2 remainder (no right-anchored last-dash logic).
- Clause shape → Option D: single `value` field polymorphic by op. No-value ops (`ex`/`nx`) omit `value`. Multi-value ops (`in`/`btw`) produce `value: [...]`. Single-value ops produce scalar `value`.

**Symbol renames** (per the F5 table in `car-rental-feedback.md`):

| Old                       | New                   | Sites                                                                   |
| ------------------------- | --------------------- | ----------------------------------------------------------------------- |
| `parseFFilter`            | `parseFilter`         | parse-filter.js (new), rest-core/index.js, handler/handler.js, tests    |
| `FFilterClause`           | `FilterClause`        | parse-filter.d.ts (new), rest-core/index.d.ts                           |
| `parseFilter` (search)    | `parseSearch`         | parse-search.js (new), rest-core/index.js, build-list-options.js, tests |
| `options.fFilter`         | `options.filter`      | adapter.js:1849, adapter.d.ts:460, handler.js:119,130                   |
| `options.filter` (search) | `options.search`      | adapter.js:1843-1858, adapter.d.ts, build-list-options.js               |
| `adapter.applyFFilter`    | `adapter.applyFilter` | adapter.js:989, adapter.d.ts:576                                        |

**Error message cleanup:** drop `f-filter` framing in thrown errors (adapter.js:1040, 1046) — just `filter 'in' on '<field>'`.

**Clause consumer updates** (`applyFilter`, ex-`applyFFilter`): consume `value` (singular polymorphic) instead of `values` array. Op-arity dispatch unchanged otherwise.

**Test updates** (`tests/test-rest-core.js`): rename all `parseFFilter` → `parseFilter` callers; update clause shape assertions to polymorphic `value`; update URL grammar fixtures to `?eq-field=`, `?in-field=`, etc.

**Phase 1 done when:** all checks green + URL grammar test fixtures reflect Option W + clause shapes polymorphic per Option D.

## Phase 2 — `ensureTable` default flip (F1) + shorthand knobs (F2)

Independent small breaking changes.

**F1:**

- `src/provisioning/ensure-table.js`: default branch flips. Absence of `options` (or any options object without `dryRun: true`) now executes. `{dryRun: true}` returns plan without writing. Drop `{yes}` handling entirely.
- `bin/dynamodb-toolkit.js`: CLI `ensure-table` defaults to `--dry-run`; `--yes` / `--execute` flips to write. Translate to the module's `{dryRun: true}` or no-options call.
- Tests + CLI integration tests.

**F2:**

- `src/adapter/adapter.js` option normalization: `structuralKey: '_sk'` string shorthand → `{name: '_sk', separator: '|'}`. `|` as default separator.
- `typeDiscriminator` string shorthand is already supported (adapter.js:228) — verify.
- Tests.

## Phase 3 — `buildKey` simplification (F9 Stage 1)

**`src/adapter/adapter.js`** (`buildKey` at :707):

- Default: children (no `kind` required).
- Drop `kind: 'exact'` branch entirely.
- `{partial: 'abc'}` alone triggers partial-match (no `kind: 'partial'` needed).
- New `{self: true}` option: emits `begins_with(_sk, <base-without-separator>)` for self + descendants.
- Q19: add prefix-collision validation at construction — if any two `typeLabels` values are prefixes of each other, throw at Adapter construction. Cheap insurance for `{self: true}` correctness.

**Internal callers** (all pass `{kind: 'children'}` today — drop it):

- adapter.js:1447, 1458, 1643, 1678, 1708

**Test updates:** rewrite `buildKey` tests to cover the new shapes; drop `kind: 'exact'` cases.

## Phase 4 — Additive polish (E2, E3, E5, E6)

Small additions, no dependencies between them. Can land together or separately.

- **E2** hide descriptor: `getListByParams` and `getList` inject `NOT (<pk> = :__descriptorKey)` into FilterExpression when adapter has `descriptorKey` set. Opt-out via `{includeDescriptor: true}`.
- **E3** hook builders: export `stampCreatedAtISO()` / `stampCreatedAtEpoch()` from `dynamodb-toolkit/hooks` (or root). Small factory functions returning `prepare` callbacks. (May become redundant after F6 registry; ship anyway.)
- **E5** sugar: `adapter.getListUnder(partialKey, options)` = `buildKey(partialKey, {})` + `getListByParams`.
- **E6** filterable types: `filterable: {year: {ops: ['eq','ge','le','btw'], type: 'number'}}` supported alongside `filterable: {year: ['eq','ge','le','btw']}`. `_coerceFilterValue` (adapter.js:967) honors the `type` for non-string coercion.

## Phase 5 — `typeField` auto-populate (F10 core)

**`src/adapter/adapter.js`**:

- New option `typeField: 'kind'` (name only; string shorthand).
- Built-in prepare step (the one that handles structural-key, searchable mirrors, sparse markers) appends: if `typeField` set and item has no value at that field, set `item[typeField] = typeOf(item)`.
- `typeOf` logic unchanged — reads the same field if a discriminator is set, depth fallback otherwise. User-written values win (same resolution as today).

**Tests:** round-trip — write a state record with no `kind` set, read back, assert `kind === 'state'`. Same for leaf + explicit discriminator override.

## Phase 6 — Example refresh (F3, F4, F6 Stage 1, F7, F8)

All in `examples/car-rental/`. API surface must be finalized (Phases 1–5 landed) before example rewrites.

- **F3** seed-data: add state records (`{state, manager: {…}}`) and facility records (`{state, facility, address, manager}`). ~8–10 additional records.
- **F4** bulk-load: new `§Seed (bulk)` section using `adapter.putItems(seedVehicles)`. Keep a smaller per-item `.post()` section too so both patterns are visible.
- **F6 Stage 1** marshalling wire-through: adapter's prepare/revive hooks use `marshallers.dateISO.marshall` / `.unmarshall` from `dynamodb-toolkit/marshalling` instead of calling `new Date().toISOString()` / raw parsing. No registry — just demonstrates the intended hook pattern.
- **F7** TS counterparts: `adapter.ts` + `run.ts` alongside the `.js` files. `tsx`-runnable via `node --import tsx/esm examples/car-rental/run.ts` or similar. Compile-checked via `ts-check` script.
- **F8** GSI/LSI sections in `run.js`: add §LSI (`by-price` auto-selected by `sort: 'dailyPriceCents'`) and §GSI (`by-status-createdAt` via explicit `index` arg). `adapter.buildKey({indexName: '...'})` activation (Q17) bundled here — lands if trivial, parked if it opens a design rabbit hole.

## Phase 7 — Wiki recipe book (F10 patterns + hierarchical pages)

Largest single body of work. Follows the `project_wiki_recipe_book` memory — pattern-first, SQL-comparison framing, cost trade-offs flagged.

**New pages (minimum set):**

- "List all records of a single tier" (F10 Pattern 1 with `typeField`).
- "Per-tier sparse GSI markers" (F10 Pattern 2).
- "Within-partition tier filtering via sparse LSI" (F10 Pattern 3).
- "Query children vs. self+children" (F9 `buildKey` new shapes).
- "Filter URL grammar" (Option W: `?eq-field=`, `?in-field=`, etc.) + `options.filter` structured clauses.
- "Text search with searchable mirror columns" (`options.search` + `searchable` declaration).
- "Cascade: rename / clone / delete subtrees" (A6').
- "Optimistic concurrency with versionField".
- "Resumable mass ops with cursor + maxItems".
- "Provisioning: ensureTable + verifyTable + descriptor record".

**Release notes entry** in `wiki/Release-notes.md` — per-minor breakdown plus a top-level "breaking changes" summary for 3.7.0.

## Phase 8 — Release

- Version bump `package.json` → `3.7.0`.
- README refresh (highlights reflecting new filter grammar + `typeField` + `buildKey` shapes).
- Tag `3.7.0` locally.
- Publish to npm.

## Dependency graph

```
Phase 1 (names + grammar)  ─┐
Phase 2 (F1/F2)             ├→ Phase 3 (buildKey) ─→ Phase 4 (polish) ─→ Phase 5 (typeField) ─→ Phase 6 (example) ─→ Phase 7 (wiki) ─→ Phase 8 (release)
                            │
                           (Phase 2 can parallel Phase 1 but sequencing is simpler)
```

Phase 6 blocks on Phases 1–5 because the example exercises the final API.
Phase 7 blocks on Phases 1–6 because recipes show final API + use updated example as their reference shape.

## Not in scope

- Marshalling registry (F6 Stage 2) — deferred to `dev-docs/marshalling-registry.md`, awaiting Eugene's sketch.
- Root-level list method (F9 Stage 2) — revisit when use case surfaces.
- Sharded-marker variant for leaf-tier scale (F10 Pattern 1 scaled) — revisit at first hot-partition report.
- Per-tier `tierMarkers` auto-write (F10 Pattern 2 enabler) — revisit when Pattern 1 isn't enough.
- Multi-Adapter shared-table dispatch (hierarchical Q13) — no use case.
- Adapter 0.3.0 Tier-B extractions — separate coordination round, not on the 3.7.0 clock.
