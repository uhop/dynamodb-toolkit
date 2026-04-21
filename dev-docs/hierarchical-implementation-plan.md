# dynamodb-toolkit — Hierarchical workstream implementation plan

> **Status:** approved 2026-04-21 (second design session). Tracks implementation of the hierarchical-workstream resolutions in `dev-docs/hierarchical-use-case.md`.
> **Posture:** additive to v3.1.2 shipped on npm. All pinned decisions respect the two foundational principles:
>
> 1. **Thin SDK-helper** — consume / produce SDK types, same semantics, introduce own concepts only when strictly needed.
> 2. **No client-side list manipulation** — no sort / filter / reshape after the DB returns; refuse with a clear error when the DB cannot answer natively.
>
> Phased across five minor releases (3.2.0 → 3.6.0). Each release is internally coherent, shipped when ready, with its own release notes and wiki updates.

---

## Phase order and dependencies

```
3.2.0 Foundation      ← declaration + A1' + filter grammar + naming cleanup
  ↓
3.3.0 Mass-op resume  ← cursor, options bag, edit(), macros
  ↓
3.4.0 Concurrency     ← versionField, asOf, marshalling helpers
  ↓
3.5.0 Cascade + A6'   ← relationship declaration, cascade primitives
  ↓
3.6.0 Provisioning    ← ensureTable / verifyTable / CLI
```

Each phase can ship standalone. Later phases build on earlier but do not require them to be feature-flag-gated together. Wiki work runs parallel to code work, one page lands with each phase.

---

## Phase 3.2.0 — Foundation: declaration, A1', filter grammar, naming

Biggest release of the workstream. Makes hierarchical adapters declarative instead of hook-coded, ships the read-side key-condition helpers, lands the final filter grammar, and cleans up the misleading "List" names.

### Adapter declaration shape (§"Adapter index declaration" in design doc)

- [ ] **`src/adapter/adapter.js`** — accept new construction options:
  - `technicalPrefix?: string` (opt-in; default unset)
  - `keyFields: Array<string | {field, type?: 'string' | 'number' | 'binary', width?: number}>` — string shorthand = type `'string'`; `width` required on `{type: 'number'}` in composite keys
  - `structuralKey?: {field: string, separator?: string}` — required when `keyFields.length > 1`; separator defaults to `'|'`
  - `indices?: Record<string, {type: 'gsi' | 'lsi', pk?, sk, projection?: 'all' | 'keys-only' | string[], sparse?: boolean | {onlyWhen: (item) => boolean}, indirect?: boolean}>`
  - `typeLabels?: string[]` — paired 1:1 with `keyFields` (length validated at construction)
  - `typeDiscriminator?: {field: string}` — wins over depth-based detection when the field is present on the item
  - `filterable?: Record<string, Array<'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in' | 'btw' | 'beg' | 'ct' | 'ex' | 'nx'>>` — allowlist for `f-` filter grammar
  - Legacy `indirectIndices` coexists; auto-synthesises `{type: 'gsi', indirect: true, projection: 'keys-only'}` entries into `indices`.

- [ ] **`src/adapter/adapter.d.ts`** — full typings for the above. `Adapter<TItem, TKey>` generics unchanged at the signature level.

- [ ] **Validation at construction:**
  - `typeLabels.length === keyFields.length` (when both declared).
  - Every adapter-managed field name (structural key, search mirror, sparse markers, versionField, createdAtField when they land) starts with `technicalPrefix` (when declared).
  - Composite `keyFields` with number components require `width`.

### Built-in `prepare` / `revive` steps (gated by `technicalPrefix`)

- [ ] **`src/adapter/hooks.js`** — add two built-in steps that run before the user hook:
  - **Built-in prepare**: reject incoming fields starting with `technicalPrefix` (input validation); compute `structuralKey` field from `keyFields` per the contiguous-from-start rule (with number zero-padding); write `searchable` mirrors; write sparse-GSI marker fields per `indices[*].sparse` predicates.
  - **Built-in revive**: strip every field starting with `technicalPrefix`.
- [ ] **`technicalPrefix` unset → built-in steps are no-ops.** Existing adapters without the declaration are byte-for-byte identical.
- [ ] **Sparse predicate throw policy**: errors from `onlyWhen` propagate unchanged (per the standing "user callbacks throw" rule). No toolkit wrap.

### A1' helpers (§"Read-side key-condition helpers")

- [ ] **`src/expressions/key-condition.js`** + `.d.ts` — new primitive:
  ```js
  buildKeyCondition({field, value, kind, pkField?, pkValue?}, params = {}) => params
  ```
  Adapter-agnostic; merges into `params` with counter-based placeholders (`#kc0` / `:kcv0`), AND-combined with existing `KeyConditionExpression`.
- [ ] **`src/adapter/adapter.js`** — `adapter.buildKey(values, {kind?: 'exact' | 'children' | 'partial', partial?: string, indexName?: string}, params = {}) => params`. Validates `values` contiguous-from-start against declared `keyFields`; joins using declared `structuralKey.separator`; delegates to the primitive.

### `adapter.typeOf(item)` (§"Type detection via `adapter.typeOf(item)`")

- [ ] **`src/adapter/adapter.js`** — method returning:
  1. `typeDiscriminator.field` value when present on the item.
  2. `typeLabels[depth - 1]` where `depth` is contiguous-from-start defined `keyFields` count.
  3. Raw depth number when `typeLabels` is not declared.

### Canned `mapFn` builders (§"Mass clone / move / edit" → "Canned `mapFn` builders")

- [ ] **`src/mass/map-fns.js`** + `.d.ts`:
  - `mergeMapFn(...fns)` — free function, pipes multiple mapFns.
- [ ] **`src/adapter/adapter.js`** — adapter methods (need access to `keyFields` / `structuralKey`):
  - `adapter.swapPrefix(srcPrefix, dstPrefix)` — subtree clone/move prefix swap.
  - `adapter.overlayFields(obj)` — static overlay; validates against `keyFields`.

### Filter grammar `f-<field>-<op>=<value>` (§"Filter surface")

- [ ] **`src/rest-core/parsers/parse-filter.js`** (or new file) — parser that:
  - Strips `f-` prefix.
  - Splits field and op from the right against the closed op set.
  - Applies `filterable` allowlist (400 `BadFilterField` or `BadFilterOp` on rejection).
  - Emits `FilterExpression` by default; auto-promotes to `KeyConditionExpression` per rules:
    - `eq` on partition key → KC.
    - `beg` on sort key → `begins_with(sk, :v)` in KC.
    - `btw` on sort key → `BETWEEN` in KC.
    - Pairs (`ge` + `le`) on the same indexed sort key merge to `BETWEEN`.
  - Multi-value (`in`, `btw`): first-character-delimiter with `,` fallback. `btw` requires exactly 2 values; `in` requires 1..N.
  - Type coercion from declared `keyFields` / `indices` types.

- [ ] **Replace `?prefix=…`** with `f-<sort-key-field>-beg=…`. Parse both for one minor; then drop `?prefix=` in 3.3.0 release notes.

### Projection ergonomics (§"Projection ergonomics")

- [ ] **Refuse `consistent: true` on GSI Query** — emit `ConsistentReadOnGSIRejected` with message citing the AWS doc. Detect at request-build time.
- [ ] **Sort → index inference** — `?sort=<field>` / `?sort=-<field>` finds an index where `sk.field === <field>`. LSI preferred over GSI when both match.
- [ ] **No matching index → refuse** with `NoIndexForSortField`. No in-memory sort (per the no-client-side-list-manipulation principle).
- [ ] **Keys-only list shortcut** — `?fields=*keys` expands to `ProjectionExpression` from declared `keyFields + structuralKey.field`. Programmatic alias: `{keysOnly: true}`.

### Naming cleanup (§"Naming cleanup — drop 'List' from bulk-individual-read helpers")

- [ ] **Consolidate `readListByKeys` + `readOrderedListByKeys` → `readByKeys`** — always ordered, length-preserving, `undefined` at missing positions.
  - New file: `src/mass/read-by-keys.js` + `.d.ts` (content = current `read-ordered-list-by-keys.js`).
  - Delete: `src/mass/read-list-by-keys.js`, `src/mass/read-ordered-list-by-keys.js` (old content).
- [ ] **Rename `deleteListByKeys` → `deleteByKeys`** — file rename, same content.
- [ ] **Deprecated aliases** in `src/mass/index.js`: `readListByKeys`, `readOrderedListByKeys`, `deleteListByKeys` exported as aliases with a one-time `console.warn` pointing at the rename. Aliases removed in 3.3.0 or 4.0.0.
- [ ] **Switch internal callers** in `src/adapter/adapter.js`:
  - `getByKeys` (line ~226) → uses `readByKeys` (consolidated, ordered). **Fixes D2** (missing-items silently dropped).
  - `getAllByParams` indirect second hop (line ~270) → uses `readByKeys`.
  - `cloneByKeys` / `moveByKeys` internals → use `readByKeys`; order doesn't matter for these but consistent API.

### D2 fix (length-preserving arrays for bulk-individual reads)

- [ ] **`src/adapter/adapter.js`** — `getByKeys` returns `Array<Item | undefined>` (length matches input keys). Drop the `if (item) out.push(...)` filter.
- [ ] **Wire-level `-by-names`** — update handler response serialization to emit `null` at missing positions instead of omitting.
- [ ] **Release notes** — call out the wire-level break; most consumers who spread the array are unaffected, consumers that assume `result.length === names.length` now get correct behaviour.

### New toolkit-named error classes

- [ ] **`src/errors.js`** (or co-located) + `.d.ts` — introduce named error classes for constraints the toolkit detects:
  - `NoIndexForSortField`
  - `ConsistentReadOnGSIRejected`
  - `AmbiguousDestination` (thrown when clone/move has no `mapFn`)
  - `BadFilterField` / `BadFilterOp` (thrown by `filterable` allowlist rejections at the parser layer)
  - Existing `BadBody` / `BadContentLength` stay in the handler layer.

### Exit criteria

- All declaration fields validated at Adapter construction.
- Built-in prepare/revive steps gated by `technicalPrefix`; adapters without it unchanged.
- `adapter.typeOf`, `adapter.buildKey`, `adapter.swapPrefix`, `adapter.overlayFields` pass unit tests.
- `buildKeyCondition` primitive passes unit tests (placeholder naming, params merge, AND-combination).
- `f-` filter grammar parses and compiles; `filterable` allowlist enforced; auto-promotion to KC verified.
- `?fields=*keys` expands correctly.
- `ConsistentReadOnGSIRejected` / `NoIndexForSortField` thrown at the right moments.
- `readByKeys` consolidated and passes round-trip tests.
- `getByKeys` returns length-preserving array; `-by-names` returns `null` for misses.
- Deprecated aliases warn once per process.
- Full test matrix green (Node / Bun / Deno, integration + e2e against DynamoDB Local).

### Wiki work (parallel)

- [ ] **W1 — Hierarchical use case walkthrough.** SQL-developer framing; explain structural keys, `begins_with`, type detection. Uses car-rental example from `hierarchical-use-case.md`.
- [ ] **Concepts page** — add new vocabulary: `technicalPrefix`, `structuralKey`, `indices` (GSI/LSI declaration), `typeOf`, `filterable`.
- [ ] **Filter grammar page** — `f-<field>-<op>=<value>`, op table, first-char-delimiter rule, examples.

---

## Phase 3.3.0 — Mass-op resumability + `edit()` + composed macros

Mass clone / move / edit become resumable, failure-buckets become structured, in-place per-item updates become first-class. Foundation declaration from 3.2.0 is a prerequisite.

### Cursor + options bag (§"Idempotent-phases mass-op shape")

- [ ] **`src/mass/cursor.js`** + `.d.ts` — opaque base64 cursor:
  - `encodeCursor({LastEvaluatedKey, op?, phase?, meta?}) => string`
  - `decodeCursor(cursor) => payload` (named export, doc'd as debugging-only, not a stable API).
- [ ] **Common mass-op options type** — shared across clone / move / edit / delete variants:
  ```ts
  type MassOpOptions = {
    ifNotExists?: boolean;
    ifExists?: boolean;
    maxItems?: number;
    resumeToken?: string; // opaque cursor
    // + op-specific: mapFn, readFields, allowKeyChange, ...
  };
  ```
- [ ] **Common return envelope:**
  ```ts
  type MassOpResult = {
    processed: number;
    skipped: number;
    failed: Array<{
      key;
      reason: 'ConditionalCheckFailed' | 'ValidationException' | 'ProvisionedThroughputExceeded' | 'Unknown';
      details?: string;
      sdkError?: unknown;
    }>;
    conflicts: Array<{key; reason: 'VersionConflict'; sdkError?: unknown}>;
    cursor?: string;
  };
  ```
  `conflicts` populated when `versionField` is declared (3.4.0 dependency — ships empty in 3.3.0).

### Clone / move write model (§"Mass clone / move / edit — pinned write model")

- [ ] **`mapFn` mandatory** on all mass clone/move (TS type-level). Runtime `AmbiguousDestination` guard for JS callers.
- [ ] **Strategy dispatch**:
  - No conditions, no `versionField` → `BatchWriteItem` (Put chunks; Put+Delete pairs chunked for move).
  - `{ifNotExists}` / `{ifExists}` → per-item `PutItem` + `ConditionExpression`.
  - `versionField` (3.4.0) → per-item `PutItem` + version condition.
- [ ] **`rename(from, to, {mapFn})`** — copy-if-not-exists then delete-if-exists. Phase order: constructive-before-destructive.
- [ ] **`cloneWithOverwrite(from, to, {mapFn})`** — delete-if-exists then copy-if-not-exists. Phase order: destructive-before-constructive; safe via idempotent rerun.
- [ ] **Cursor tracks phase** for macros; implementation records phase completion per item (cursor advances only after both phases done for an item).

### `edit(mapFn, {readFields?})` (§"`edit(mapFn)` diff mechanics")

- [ ] **`src/adapter/adapter.js`** — `adapter.edit(key, mapFn, options?)`:
  - `readFields` limits `ProjectionExpression` on the `GetItem` phase.
  - mapFn returns full object; toolkit shallow-diffs against the input item.
  - Emits `UpdateItem` with `SET` / `REMOVE` clauses per diff.
  - Deep-equal short-circuit on unchanged nested fields.
- [ ] **Key-field-change guard** — toolkit detects `keyFields` changes in the diff and throws `KeyFieldChanged` unless `{allowKeyChange: true}`. With the flag, auto-promote to a clone+delete path.
- [ ] **Mass `editAllByParams`** — naming and shape follow clone/move mass-op family.

### Exit criteria

- Mass ops accept the unified options bag; returns the unified envelope.
- Cursor round-trips via base64 (opaque to caller, structured under the hood).
- `decodeCursor` usable from tests / debugging.
- `rename` and `cloneWithOverwrite` both ship; phase order verified via crash-injection tests.
- `edit()` passes round-trip tests (diff correctness, deep-equal short-circuit).
- `KeyFieldChanged` thrown by default; `{allowKeyChange}` auto-promotes correctly.
- Deprecated aliases from 3.2.0 removed.

### Wiki work

- [ ] **W6 — Mass-operation semantics.** Resumability via idempotent phases, cursor usage, return-shape interpretation, three-line resume-until-empty loop.
- [ ] **Add `edit()` section** to the CRUD page.
- [ ] **Breaking changes callout** for the dropped aliases.

---

## Phase 3.4.0 — Concurrency mechanisms + Marshalling helpers

Optimistic concurrency and the marshalling helpers for types the SDK can't round-trip cleanly.

### `versionField` (§"Concurrency-support mechanisms" → Q26)

- [ ] **`src/adapter/adapter.js`** — accept `{versionField: string}` at construction.
- [ ] **Auto-condition** on all writes (put, update): `ConditionExpression: attribute_not_exists(<pk>) OR <versionField> = :v`. Auto-increment the field on success.
- [ ] **Delete** uses `ConditionExpression: <versionField> = :v`; does not increment.
- [ ] **Mass-op integration** — `conflicts` bucket populates when version check fails; distinguished from other `ConditionalCheckFailed` cases.
- [ ] **Declaration validation** — `versionField` must start with `technicalPrefix` when declared (auto-strips on revive).

### `asOf` scope-freeze (§Q27)

- [ ] **`src/adapter/adapter.js`** — accept `{createdAtField: string}` at construction.
- [ ] **Mass-op option** `{asOf: Date | string}` — emits `FilterExpression: <createdAtField> <= :asOf`, AND-combined with caller's FilterExpression.
- [ ] **Without `createdAtField`** declared → throws `CreatedAtFieldNotDeclared`.

### Marshalling helpers (§"Marshalling helpers" → Q31 / Q32)

- [ ] **`src/marshalling/index.js`** + `.d.ts` — module entry, re-exports.
- [ ] **`src/marshalling/date.js`** — `marshallDateISO` / `unmarshallDateISO`, `marshallDateEpoch` / `unmarshallDateEpoch`. No generic `marshallDate` alias.
- [ ] **`src/marshalling/map.js`** — `marshallMap(map, valueTransform = x => x)`, `unmarshallMap(obj, valueTransform = x => x)`.
- [ ] **`src/marshalling/url.js`** — `marshallURL`, `unmarshallURL`.
- [ ] **`package.json` `exports`** — add `./marshalling` subpath.
- [ ] **TypeScript `Marshaller<TRuntime, TStored>`** pair helper in `marshalling.d.ts` — nudges toward symmetric wiring.
- [ ] **Deferred: `RegExp`, `Error`, Temporal types, Q31' registry.** Documented as future-additive in the wiki, parked in the queue.

### Exit criteria

- `versionField` round-trip verified: first insert succeeds; stale version rejects; `conflicts` bucket populates correctly; delete guarded.
- `asOf` emits correct `FilterExpression`; `CreatedAtFieldNotDeclared` thrown when unset.
- Marshalling helpers pass round-trip tests for each type plus `Map<string, Date>` nested case.
- `marshalling` subpath resolves from `dynamodb-toolkit/marshalling`.

### Wiki work

- [ ] **Concurrency caveats section in W6** — `versionField` when it helps/doesn't; `asOf` scope-freeze; application-level locking for strict atomicity.
- [ ] **Marshalling page** — which types, how to wire, symmetric-pair rule, round-trip test recipe.

---

## Phase 3.5.0 — Cascade + A6' relationship declaration

Developer-primitive cascade for hierarchical deletes / clones / moves. The declaration surface (A6') and the cascade methods.

### Relationship declaration

- [ ] **`src/adapter/adapter.js`** — accept `{relationships?: ...}` at construction. Shape TBD at implementation-kickoff micro-design — candidates:
  - Parent → children mapping by `keyFields` depth.
  - Parent → children mapping by type label (from `typeLabels`).
  - Per-relationship cascade policy (e.g., "rename propagates to all descendants").

  Spec the shape in a short follow-up design note before coding. Commit to one shape before tests land.

### Cascade primitives

- [ ] **`adapter.deleteAllUnder(key)`** — leaf-first delete of the subtree rooted at `key`.
- [ ] **`adapter.cloneAllUnder(srcKey, dstKey, {mapFn?})`** — root-first subtree clone. `mapFn` for per-item transform.
- [ ] **`adapter.moveAllUnder(srcKey, dstKey, {mapFn?})`** — copy-then-delete subtree.
- [ ] **Throw `CascadeNotDeclared`** when called without a relationship declaration.
- [ ] **Naming final call** — `...Under` or `...Cascade` — pin at implementation.

### REST integration

- [ ] **Default REST handler unchanged.** `DELETE /key` stays single-row. Developers wire cascade endpoints themselves by calling `adapter.deleteAllUnder(key)` from their handler.

### Exit criteria

- Relationship declaration validated at construction.
- Cascade primitives pass tests against multi-level hierarchies.
- `CascadeNotDeclared` thrown when relationships absent.
- Default `DELETE /key` behaviour verified unchanged.

### Wiki work

- [ ] **Cascade surface page** — developer primitive vs. URL convention distinction, relationship-declaration shape, examples.

---

## Phase 3.6.0 — T1 / T2 provisioning helpers

Table-lifecycle support driven by the Adapter declaration. Ships as a separate submodule + CLI so IaC users can skip it entirely.

### `src/provisioning/`

- [ ] **`src/provisioning/ensure-table.js`** + `.d.ts`:
  - `ensureTable(adapterOrDeclaration, client, {yes?, dryRun?}) => Promise<Plan | Result>`.
  - Computes diff between declared schema and `DescribeTable` output.
  - ADD-only plans (`CreateTable`, `UpdateTable` with `{Create: GSI}`).
  - Never emits destructive plan entries.
  - Delegates legality to DynamoDB (no pre-checks).
  - Prints plain-text plan for dry-run.
  - Requires `yes: true` (or CLI `--yes`) for execution; default returns plan.
- [ ] **`src/provisioning/verify-table.js`** + `.d.ts`:
  - `verifyTable(adapterOrDeclaration, client, {throwOnMismatch?, requireDescriptor?}) => Promise<{ok, diffs: Array<{path, expected, actual, severity}>}>`.
  - Compares key schema, GSI/LSI key schemas + projection specs.
  - Billing mode / stream config compared only when declared.
  - `throwOnMismatch: true` throws `TableVerificationFailed` carrying the diff.
  - Default: structured result, no throw.
- [ ] **`src/provisioning/descriptor.js`** + `.d.ts` — opt-in reserved-record descriptor:
  - Written on first `ensureTable` / `verifyTable` when `{descriptorKey: string}` is declared on the Adapter.
  - Compared on subsequent verify calls.
  - Shape: `{version, generatedAt, adapter, keyFields, structuralKey, indices, searchable, filterable, marshalling, versionField, createdAtField}`.
  - `{requireDescriptor: true}` → missing descriptor is a verify failure.
  - Default: absent descriptor is neutral (IaC-managed tables).
- [ ] **`src/provisioning/index.js`** + `.d.ts` — module entry.
- [ ] **`package.json` `exports`** — add `./provisioning` subpath.

### CLI wrapper

- [ ] **`bin/dynamodb-toolkit.js`** — CLI entry. Subcommands:
  - `dynamodb-toolkit ensure-table <adapter-module>` — loads the module (ESM import), extracts the adapter, calls `ensureTable`. Requires `--yes` for execution.
  - `dynamodb-toolkit verify-table <adapter-module>` — calls `verifyTable`, prints the diff, exits non-zero on mismatch when `--strict`.
- [ ] **`package.json` `bin`** — add `"dynamodb-toolkit": "./bin/dynamodb-toolkit.js"`.

### Exit criteria

- `ensureTable` + `verifyTable` pass tests against DynamoDB Local (create / add GSI / verify / drift detection).
- Descriptor record round-trip verified.
- CLI loads an ESM adapter module and runs both commands.
- IaC-managed table flow (T2 only) documented and tested.

### Wiki work

- [ ] **T1 / T2 provisioning page** — when to use, IaC interaction, dry-run, confirmation flow, descriptor record.

---

## Deferred / parked

Tracked but not part of this workstream. Revisit when concrete demand surfaces.

- **Q31' — Adapter-registry walker for marshalling** (`adapter.addType` + `adapter.marshallObject`). Additive to the standalone marshalling functions; ship when nested-type ergonomics demand it or a declarative schema integration (zod, TS-schema bridge) makes the registry the natural bridge.
- **Transactional `rename` / `cloneWithOverwrite`** — `TransactWriteItems` bundles of the two phases for atomicity. Collides with the idempotent-phases model (transactions are all-or-none; idempotent phases assume per-item independence). Wait for a concrete caller.
- **`marshallArray` and other container helpers** — ship only when a user hits the case (SDK handles plain arrays of primitive types already).
- **Temporal-aware marshallers** — wait for stage 4 and broad runtime support.
- **Multi-Adapter shared-table dispatch** — `adapter.typeOf` is single-Adapter only; cross-Adapter routing needs its own design pass. Post-3.x.

---

## Cross-cutting work

Standing rules that apply to every phase's implementation:

### User-supplied callbacks throw; toolkit does not wrap

Applies across every caller-supplied extension point: `prepare` / `revive` / `validateItem` / `checkConsistency` hooks, `mapFn` on clone/move/edit, `sparse.onlyWhen` predicates, `exampleFromContext` callbacks, `valueTransform` in container marshallers. No `try/catch`-and-rethrow that renames or annotates caller errors. Caller's error class, message, and stack surface unchanged.

Toolkit-named errors apply to constraints the toolkit detects itself; see the enumerated list at the top of this document.

### Principle-driven review checklist

For every PR touching this workstream, check:

- Does it introduce a new concept? If yes, is it strictly needed per the SDK-helper principle?
- Does it do any list manipulation after the DB returns? If yes, refuse and fail with a toolkit-named error instead.
- Does it preserve SDK error identity where it reduces errors into a closed enum? (`sdkError?: unknown` on reductions.)
- Does it wrap a caller-supplied callback's error? If yes, unwrap — let it propagate.
- Does it name "List" for DB-produced sets vs. drop "List" for caller-supplied bulk-individual?

---

## Framework adapters coordination (0.3.0 line)

The four framework adapters (`dynamodb-toolkit-koa`, `-express`, `-fetch`, `-lambda`) are thin wrappers around parent's `rest-core` + `handler`. The hierarchical workstream is mostly below the REST surface — adapters inherit most changes transparently via the parent package. A coordinated **0.3.0 adapter line** captures the wire-visible updates and the already-queued Tier-B extraction in one release round.

### What adapters inherit automatically (no code change)

- New declaration fields (`technicalPrefix`, `indices`, `typeLabels`, `typeDiscriminator`, `filterable`, `versionField`, `createdAtField`, `relationships`) — construction-time, user-code only.
- Built-in prepare/revive steps — runtime behaviour inside Adapter methods.
- New Adapter methods (`typeOf`, `buildKey`, `swapPrefix`, `overlayFields`, `edit`, `rename`, `cloneWithOverwrite`, `deleteAllUnder`, `cloneAllUnder`, `moveAllUnder`) — programmatic API, no REST routing impact unless the user wires them explicitly.
- Marshalling helpers — user hooks.
- Provisioning (`ensureTable`, `verifyTable`) — separate submodule + CLI.
- Cascade primitives — developer wires routes themselves; adapters pass through.

### What adapter tests need to update (wire-visible changes)

**Parent 3.2.0:**

- **`-by-names` response: `null` at missing positions** (D2 fix). Adapter tests asserting compact arrays need to migrate to length-preserving assertions.
- **Filter grammar absorption**: `?prefix=foo` → `?f-<sort-key-field>-beg=foo`. Old `?prefix=` form removed; test fixtures migrate.
- **New toolkit error classes**: parent's `mapErrorStatus` maps `NoIndexForSortField`, `ConsistentReadOnGSIRejected`, `BadFilterField`, `BadFilterOp`, `AmbiguousDestination`, `KeyFieldChanged`, `CreatedAtFieldNotDeclared`, `CascadeNotDeclared` to HTTP statuses. Adapter tests verify the wire response matches.
- **`?fields=*keys` wildcard**: no code change; add one smoke test per adapter confirming routing.

**Parent 3.3.0:**

- **Mass-op response envelope**: `{processed, skipped, failed, conflicts, cursor?}` replaces `{processed: N}` on endpoints that delegate to mass ops (`-clone-by-names`, `-move-by-names`, mass delete with filter, etc.). Tests migrate from exact-match to partial-match or updated full-shape.
- **New REST routes** if parent exposes `edit`, `rename`, `cloneWithOverwrite` via meta-markers — watch release notes; add coverage if routes materialise.

**Parent 3.4.0, 3.5.0, 3.6.0:** no adapter-visible wire changes. `versionField` / `asOf` / cascade / provisioning are all below or beside the REST surface.

### Adapter 0.3.0 scope (per adapter)

- [ ] Peer-dep bump: `"dynamodb-toolkit": "^3.2.0"` (or whichever parent minor delivers the wire changes first — likely 3.3.0 to capture both rounds together).
- [ ] Dev-dep bump to exact parent version for CI reproducibility.
- [ ] Test fixtures migrated: D2 null placeholders, `f-` filter grammar, new error-class HTTP status assertions.
- [ ] Smoke test for `?fields=*keys`.
- [ ] Smoke test for mass-op envelope shape.
- [ ] **Tier-B handler-core extraction** (route dispatcher switch + handler cores from the audit-extraction proposal, ~800 LoC × 4) — lands in the same cycle **if** the neutral `{status, body, headers}` result shape has converged by then. Otherwise defers to 0.4.0.
- [ ] Wiki updates per adapter for any new routes / response shapes.
- [ ] `AGENTS.md` / `llms.txt` / `llms-full.txt` pointers refreshed.

### Release vehicle + timing

**Preferred:** adapter 0.3.0 line coordinated release **after parent 3.3.0 ships** — captures both the 3.2.0 wire changes and the 3.3.0 mass-op envelope in one adapter update. Matches the D1-cadence pattern that worked for the 0.2.0 coordinated release (parent + 4 × 0.2.0 in one session).

**Alternative:** adapter 0.2.1 bridge after parent 3.2.0, then 0.3.0 after parent 3.3.0 — only if Tier-B extraction isn't ready or if consumers urgently need filter-grammar support. Costs a second coordination round; skip unless a concrete ask surfaces.

**No adapter action required between parent minors:** 0.2.0's peer-dep `^3.1.2` covers every parent 3.x minor under semver. The 0.3.0 release is driven by desire to catch up tests + advertise feature compatibility, not by functional necessity.

### Per-adapter nuances

- **koa** — no adapter-specific nuances. Ride with the shared scope.
- **express** — verify `res.headersSent` guard in `sendError` still catches new error classes correctly (already-sent responses can't re-emit status codes).
- **fetch** — verify `Content-Length: -1 / 1.5` guard from 0.1.1 fix still holds under filter-grammar fixture churn.
- **lambda** — verify `event.headers === null` defensive check still holds; confirm filter-grammar works through both v1 and v2 proxy-event shapes.

### Tracking

Per-adapter 0.3.0 scope mirrors in each adapter project's `queue.md`. Updates land alongside this document's commit. Audit-note cross-links: `projects/dynamodb-toolkit-<pkg>/audit.md` per adapter.

---

## Open micro-design questions (decide at implementation kickoff, not design)

Small details punted to coding time because they're easier decided with code in hand:

- Final naming for `adapter.swapPrefix` / `overlayFields` / `mergeMapFn` — placeholder names; pin once call-site ergonomics are visible.
- Final naming for cascade primitives (`deleteAllUnder` vs. `deleteCascade`).
- Final shape of the relationship declaration in 3.5.0 — write a short micro-design note before coding.
- Which error class to use for `ambiguous destination` in mass clone/move (single vs. separate from `AmbiguousDestination`).
- Descriptor record versioning scheme — `version: 1` now; bump on incompatible shape change.

---

## References

In-tree design artifacts:

- `dev-docs/hierarchical-use-case.md` — full design doc with every resolved question and rationale. **Primary source**; this plan is a scheduling view on top of it.
- `dev-docs/v3-plan.md` — original v3 refresh plan (completed; shipped as 3.0.0 → 3.1.2).
- `dev-docs/v3-design.md` — v3 design doc. Foundational for the existing shape; hierarchical workstream extends rather than supersedes.
- `dev-docs/v3-survey.md` — v2 → v3 feature survey.

Vault notes (Obsidian Local REST API, accessible via `vault-curl`):

- `projects/dynamodb-toolkit/decisions.md` — full decision records, per-cluster, with rationales.
- `projects/dynamodb-toolkit/queue.md` — implementation-status ledger; cluster-level progress tracking.
- `projects/dynamodb-toolkit/learnings.md` — non-obvious gotchas and insights captured during design.

Cross-project topic notes (apply to cognito-toolkit's future v3 refresh and other AWS-toolkit siblings):

- `topics/no-client-side-list-manipulation.md` — the principle itself, as a DB-adapter design rule.
- `topics/bulk-individual-vs-list-operations.md` — classification rule behind the naming cleanup.
- `topics/user-callbacks-throw-no-toolkit-wrap.md` — standing rule for extension-point errors.
- `topics/delegate-validation-to-source-of-truth.md` — wrapper-library principle, T1/T2 shape.
- `topics/declarative-schema-drives-provisioning.md` — T1/T2 pattern generalised.
- `topics/dynamodb-structured-composite-keys.md` — hierarchical-key foundation.
- `topics/first-char-delimiter-multivalue.md` — filter-grammar multi-value encoding.
