# Car-rental example — feedback round (post 3.6.1)

> **Scope.** Feedback from Eugene on the `examples/car-rental/` walkthrough and the 3.6.0/3.6.1 surface it exercises. Each section captures the observation, the current state, alternatives, and explicit open questions (`Q:`) for discussion. This doc drives the 3.7.0 design round.
>
> **Release scope (decided 2026-04-22).** **Everything lands in 3.7.0.** No 4.0 on this cycle — the API can change freely because there is effectively no 3.x userbase yet. 4.0 is reserved for "we're confident the API is right"; we aren't there yet. Deprecation paths (`console.warn` / compat shims) are unnecessary and omitted throughout.
>
> **Related.** `dev-docs/ergonomics-review-3.6.0.md` (prior round — E1–E6 findings); `dev-docs/hierarchical-use-case.md` (foundational design); `dev-docs/marshalling-registry.md` (deferred registry sketch — see F6).

## Design principles

The decisions below apply these standing rules (in addition to everything in the repo's `AGENTS.md`):

**Intentional programming.** Method / option names should express intent in the signature, not via string discriminators on a single overloaded entry. Established in the 3.6.0 design (cascade primitives `-Under` vs. `-UnderBy`).

**GIGO — no runtime type-checking of argument shapes.** TS is the contract; JS fails naturally when violated. No `if (typeof x !== 'function')` guards; no xor-mutex checks on option pairs.

**Additive-presence API design.** Each option / clause property carries intent independently. The _presence_ of a property is the signal; avoid discriminator/flag fields that merely gate another field that already implies its purpose. Two anti-patterns forbidden:

1. **Co-required.** `{kind: 'partial', partial: 'abc'}` — presence of `partial` already says "prefix-match"; the `kind` discriminator adds nothing but validation burden. Collapse to `{partial: 'abc'}`. (See F9.)
2. **Mutually exclusive.** `{value: 1, values: [2, 3]}` — two spellings requires a runtime "which wins?" rule. Collapse to a single polymorphic `value` with TS discriminated-union typing. (See F5 / Q9.)

Positive pattern: `{self: true}` adds the parent record to results; absence means "don't add"; no other field needs to agree with it. Decisions throughout the doc are checked against this principle — anywhere you spot a cross-field rule ("if X supplied, Y must be / must not be"), the shape is wrong and should be restructured, not guarded.

_Why the principle matters._ Complex APIs with cross-field validation inflate three costs simultaneously: (1) cognitive load for users, (2) implementation complexity from runtime guards, (3) test matrix for every valid/invalid combination. Additive-presence sidesteps all three — each field stands alone, TS narrows it, no runtime cross-check needed.

**Split methods when complex interactions are unavoidable.** After trying the additive-presence shape first — if options still carry genuinely different semantics that require runtime parsing to disambiguate — prefer splitting into separate entry points rather than one method that inspects args to decide what to do. Different calls signal different intent at the call site; the implementation stops branching on arg shape.

The canonical anti-pattern and its fix:

```js
// Anti-pattern: internal branch on a mode flag.
const fn = flag => {
  if (flag) {
    /* do A */
  } else {
    /* do B */
  }
};

// Fix: two entry points, no internal branch.
const fnA = () => {
  /* do A */
};
const fnB = () => {
  /* do B */
};

// Caller does dynamic dispatch at the boundary, if they need it.
const result = flag ? fnA() : fnB();
```

The split is justified when these conditions hold:

- **Substantially different implementations.** The two branches share only a handful of lines; a split cleanly separates them with no duplication.
- **Shared code is encapsulated, not duplicated.** Common algorithm becomes an internal function both entry points call. One literally reuses the other when there's a natural composition.
- **One naturally depends on the other.** e.g., `planTable()` returns a plan object; `ensureTable()` = `planTable()` + apply.

Smells that mean "split me":

- Mode discriminators (`{mode: 'plan' | 'execute'}`): split into `planX()` and `doX()`.
- Substantially different input shapes switched at the entry via `typeof` / `Array.isArray`: split into per-shape entry points.
- TS union parameters where branches don't intersect: each branch becomes its own method.

This corollary applies only after the presence-based approach fails — many presumed-complex interactions turn out to be orthogonal (e.g., `{self: true, partial: 'abc'}` on `buildKey` is each-adds-behavior, not a mode switch).

## Table of contents

1. [F1 — Dry-run default on `ensureTable` and friends](#f1--dry-run-default-on-ensuretable-and-friends)
2. [F2 — Shorthand for declaration knobs (`typeDiscriminator`, `structuralKey`, etc.)](#f2--shorthand-for-declaration-knobs)
3. [F3 — Example should populate records at every hierarchy level](#f3--example-should-populate-records-at-every-hierarchy-level)
4. [F4 — Show a bulk-load path alongside `.post()`](#f4--show-a-bulk-load-path-alongside-post)
5. [F5 — `fFilter` naming and `values: [...]` array boilerplate](#f5--ffilter-naming-and-values--array-boilerplate)
6. [F6 — Marshalling should be wired into the adapter, not imported ad-hoc](#f6--marshalling-should-be-wired-into-the-adapter)
7. [F7 — TypeScript counterparts for `adapter.js` and `run.js`](#f7--typescript-counterparts)
8. [F8 — GSI/LSI exercise: `by-status-createdAt` and `by-price`](#f8--gsilsi-exercise)
9. [F9 — `{kind, partial}` verbosity on `buildKey`](#f9--kind-partial-verbosity-on-buildkey)
10. [F10 — Tier-aware sparse indexing for single-tier queries](#f10--tier-aware-sparse-indexing)

---

## F1 — Dry-run default on `ensureTable` and friends

**Observation.** Today `ensureTable(adapter)` returns a plan without executing; `ensureTable(adapter, {yes: true})` executes. The `{yes: true}` switch is awkward — `{yes: false}` reads as "no, don't execute", which is the same as the default. CLI should default to dry-run (safety); programmatic API should default to execute (caller asked for it).

**Current state.** `src/provisioning/ensure-table.js:193` branches on `!options.yes || options.dryRun` — `{dryRun: true}` is already documented as an explicit plan-only alias. Three knobs, one axis.

**Proposal (preferred).** Flip the default and collapse to one knob:

- Module API: `ensureTable(adapter)` **executes**; `ensureTable(adapter, {dryRun: true})` returns a plan without writing.
- CLI (`bin/dynamodb-toolkit.js ensure-table …`) defaults to `--dry-run`; requires `--yes` (or `--execute`) to write. CLI translates flags into the module call.

This matches the Terraform/kubectl convention (programmatic = imperative; CLI = plan-first), and removes the `{yes: false}` ambiguity.

**Blast-radius note.** `ensureTable` is ADD-only (create table, add GSI). It can't destroy data — the worst case is an unintended table/GSI create, which is recoverable. That lowers the bar for a "default executes" decision. `verifyTable` is pure-read; no dry-run axis at all.

### Decision (2026-04-22, final)

**Split methods — no `{dryRun}` option.** Applying the split-methods addendum; F1 meets all three criteria:

- **Substantially different implementations.** Plan-only is pure read (DescribeTable + diff + return plan). Execute adds a sequence of CreateTable / UpdateTable calls + descriptor write. Not a thin tweak — different side-effect class.
- **Shared code encapsulated.** Plan computation lives in one internal function that both entry points call.
- **Natural composition.** `ensureTable()` = `planTable()` + apply.

Concrete surface:

- `planTable(adapter)` → read-only. Returns `{tableName, steps, summary}`. Never writes.
- `ensureTable(adapter)` → calls `planTable()` internally, applies the steps, returns `{plan, executed}`.
- Both drop every `{yes}` / `{dryRun}` option. Caller picks the method; no flag parsing.
- CLI mirrors the split: `dynamodb-toolkit plan-table <module>` (read-only) and `dynamodb-toolkit ensure-table <module>` (mutating). No `--dry-run` / `--yes` flags.

This also closes **Q2** by construction — a `planTable()` on a no-op table just returns `{steps: [], summary: ['Table <T> matches declaration — nothing to do']}`; the CLI prints the summary unconditionally. No silent / verbose branching.

**Phase 2 impact.** Plan-3.7.0 Phase 2 rewrites to "split `ensureTable`" instead of "flip default".

---

## F2 — Shorthand for declaration knobs

**Observation.** The car-rental adapter has several "obvious" values wrapped in objects:

```js
typeDiscriminator: {name: 'kind'},
structuralKey: {name: '_sk', separator: '|'},
keyFields: [
  {name: 'state', type: 'string'},
  {name: 'facility', type: 'string'},
  {name: 'vehicle', type: 'string'}
]
```

When the only knob on each is a name with defaults elsewhere, the object wrapper is noise.

**Current state.**

| Knob                              | Shorthand today? | Notes                                                                                                                                  |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `keyFields[i]`                    | **Yes**          | `'state'` already accepted and promoted to `{name: 'state', type: 'string'}` (adapter.js:141). The example should use the string form. |
| `typeDiscriminator`               | No               | Requires `{name, labels?}` object.                                                                                                     |
| `structuralKey`                   | No               | Requires `{name, separator}`; no default on either.                                                                                    |
| `descriptorKey`                   | Already scalar   | `'__adapter__'` — fine.                                                                                                                |
| `versionField` / `createdAtField` | Already scalar   | Fine.                                                                                                                                  |

**Proposal.**

- `typeDiscriminator: 'kind'` ⇒ `{name: 'kind'}`. Keep the object form for the case with custom labels.
- `structuralKey: '_sk'` ⇒ `{name: '_sk', separator: '|'}` using `|` as the default separator. Keep the object form when the user wants a custom separator.
- **Fix the example now** to use the already-supported `keyFields: ['state', 'facility', 'vehicle']` string form — that change is zero-cost.

**Q3.** Is `|` the right default separator? (It's what every current example uses, and it's not URL-reserved.) Or should the default be derived from `technicalPrefix` somehow? (Probably not — they're orthogonal concerns.)

**Q4.** Do we want a "fully declarative" shorthand like `structuralKey: true` that asks the toolkit to pick both name (`_sk` when `technicalPrefix: '_'`) and separator (`|`)? Might be over-magical; flag for discussion.

---

## F3 — Example should populate records at every hierarchy level

**Observation.** The original hierarchical use case had **four** record types:

- `state` records (top) — e.g., `{state: 'TX', manager: {name, email, phone}}`
- `facility` records (middle) — e.g., `{state: 'TX', facility: 'Dallas', address: '…', manager: {…}}`
- `car` records (leaf)
- `boat` records (leaf)

The current example only seeds leaf records (cars + boats) and treats the intermediate tiers as pure key prefixes. That's a weak test of `typeOf` dispatch and hides the "structural tiers carry real data too" story.

**Current state.** `examples/car-rental/seed-data.js` has 14 leaf records and zero tier-1/tier-2 records. `typeOf` dispatch on a Scan shows `{car: N, boat: N, state: 0, facility: 0, …}` — the non-leaf labels never fire except for the descriptor leak (E2 from the prior round).

**Proposal.** Extend `seed-data.js` with two or three state records and a handful of facility records. Minimum realistic shapes:

```js
// state record
{state: 'TX', manager: {name: 'Jane Doe', email: 'jane@example.com', phone: '+1-555-0100'}}

// facility record
{state: 'TX', facility: 'Dallas', address: '123 Main St', manager: {name: 'Bob', email: 'bob@…', phone: '…'}}
```

Then `run.js` can demonstrate `adapter.typeOf` returning all four labels, `buildKey({state: 'TX'}, {self: true})` (or the equivalent — see F9) returning the state record alongside its descendants, and `getByKey({state: 'TX'})` reading the state record directly.

**Q5.** Should the state/facility records validate against type-specific hook logic (e.g., schema guard) in the example to show typed dispatch all the way down, or keep it read-focused?

---

## F4 — Show a bulk-load path alongside `.post()`

**Observation.** `seed-data.js` iterates `.post()` per item. Fine for didactic purposes, but if there's a faster loader, it's worth showing.

**Current state.** Three bulk paths exist on the adapter:

| Method                      | Semantics                                                              | Prepare hook?            |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| `adapter.writeItems(items)` | Native BatchWriteItem chunked to 25, parallelized                      | Yes (via `_prepareItem`) |
| `adapter.putItems(items)`   | Wraps `writeItems` with a `strategy` knob (`'native' \| 'sequential'`) | Yes                      |
| `applyBatch` (lower level)  | Heterogeneous put+delete descriptors                                   | No — caller prepared     |

**Proposal.** Add a `§Seed (bulk)` section to `run.js` that calls `adapter.putItems(seedVehicles)` instead of the per-item loop, and keep the per-item loop elsewhere so both patterns are visible. Or split into two walkthroughs: `seed.js` (bulk) runs first; `run.js` drives the read/edit/cascade demos against the pre-seeded table.

**Q6.** Should `putItems` be the recommended entry point, or is `writeItems` preferred because the name is less ambiguous against `post`? My lean is `putItems` — the `strategy` knob makes it the fuller-featured one.

**Q7.** Do we want a **streaming** seed path (feed an async iterator of items; the toolkit batches and parallelizes)? Not on the 3.7.0 list today; call out now if we want it.

---

## F5 — `fFilter` naming and `values: [...]` array boilerplate

**Observation.** `fFilter` reads as strange — users don't know what the `f` means. `options.filter` exists, but does something different. Clause shape `{field: 'kind', op: 'eq', values: ['car']}` forces an array even for single-value ops.

**Current state.**

- `options.fFilter` — array of allowlisted, structured clauses. Compiled by `applyFFilter`; the `f-` in the name echoes the REST `?f-<field>-<op>=<value>` grammar and the `filterable` allowlist on the adapter. adapter.js:989, adapter.js:1849.
- `options.filter` — free-form search-string expression. Compiled by `buildFilter` against the adapter's `searchable` allowlist (a text-search surface, not structured). adapter.js:1852.
- `options.fields` — projection hint.

`fFilter` and `filter` **coexist** in the same call and AND together. The `f` prefix exists solely to disambiguate from the pre-existing search-filter.

**Problems.**

1. `fFilter` is a cryptic abbreviation — no hint that it ties to the REST `f-` grammar or to `filterable`.
2. `values: [v]` is painful for the single-value ops (`eq`, `ne`, `lt`, `le`, `gt`, `ge`, `beg`, `ct`, `ex`, `nx`). Only `in` (set) and `btw` (pair) genuinely need an array.
3. The prior round's E1 already flagged the `value` vs. `values` asymmetry.

**Proposal — naming.** Two workable directions; I lean B.

- **A. Rename `fFilter` → `where`.** `filter` stays as the text-search surface. `where` reads as structured/relational; `filter` as search-over-text. Pros: both names are clear; no collision. Cons: "where" is new terminology.
- **B. Rename `filter` → `search` (the free-form one), promote `fFilter` → `filter`.** `filter` becomes the common structured-clauses surface, matching what most users reach for first. `search` is unambiguously "text search against the `searchable` allowlist". Pros: gives the most-used knob the best name. Cons: breaks `options.filter` callers — scope check needed before committing.

**Proposal — clause shape.** Accept three variants at the entry point; normalize to `{field, op, values: [...]}` internally:

```js
// variadic value (best for humans)
{field: 'kind', op: 'eq', value: 'car'}

// plural for set/range ops
{field: 'kind', op: 'in', values: ['car', 'boat']}
{field: 'year', op: 'btw', values: [2020, 2024]}

// arg — unifies (user's strawman)
{field: 'kind', op: 'eq', arg: 'car'}
{field: 'year', op: 'btw', arg: [2020, 2024]}
```

I'd ship **both** `value` (singular) and `values` (array) as the E1 resolution already proposed. `arg` is a third name — cleaner conceptually but adds a third spelling. My lean is not to introduce `arg` unless we also deprecate the other two, which is a bigger break than it's worth.

### Decision (2026-04-22)

**Option B — confirmed.** `fFilter` → `filter`; current `filter` → `search`.

- `options.filter` becomes the structured-clauses surface (current `fFilter`).
- `options.search` becomes the text-search surface (current `filter`) — case-insensitive substring match against declared `searchable` mirror columns. Name aligns with the existing `searchable` / `searchablePrefix` declaration knobs end-to-end.
- Clause shape: single `value` knob, polymorphic by op (Option D, Q9):
  ```ts
  type Clause =
    | {field: string; op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'beg' | 'ct'; value: unknown}
    | {field: string; op: 'in'; value: unknown[]}
    | {field: string; op: 'btw'; value: [unknown, unknown]}
    | {field: string; op: 'ex' | 'nx'};
  ```
  TS discriminated-union narrows shape per op. One spelling, industry-standard term. `in` with a single element is `value: ['x']` — accurate to what `in` means; smart callers reach for `eq` instead.

No deprecation window — break straight through in 3.7.0.

**Full rename cascade.** Every `FFilter` / `fFilter` / `f-filter` identifier in the tree renames as part of F5 (`FFilter` is ugly — fixing it alongside the option rename). Sites to change:

| Current                                               | 3.7.0                                                                                         | Location                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `options.fFilter`                                     | `options.filter`                                                                              | adapter.js:1849; adapter.d.ts:460; handler.js:119,130                               |
| `adapter.applyFFilter(params, clauses)`               | `adapter.applyFilter(params, clauses)`                                                        | adapter.js:989; adapter.d.ts:576                                                    |
| `parseFFilter(query)`                                 | `parseFilter(query)`                                                                          | parse-f-filter.js:37; rest-core/index.js:10; handler.js:12; tests/test-rest-core.js |
| `FFilterClause` type                                  | `FilterClause` type                                                                           | parse-f-filter.d.ts:7; rest-core/index.d.ts:13                                      |
| `src/rest-core/parsers/parse-f-filter.js`             | `src/rest-core/parsers/parse-filter.js`                                                       | filename                                                                            |
| `parse-f-filter.d.ts`                                 | `parse-filter.d.ts`                                                                           | filename                                                                            |
| `options.filter` (free-form search string)            | `options.search`                                                                              | adapter.js:1843,1852–1858; adapter.d.ts; rest-core/parsers/parse-filter.js          |
| `parseFilter(input, options)` (search-text parser)    | `parseSearch(input, options)`                                                                 | parse-filter.js:5; rest-core/index.js:5; build-list-options.js:9,15; tests          |
| `src/rest-core/parsers/parse-filter.js` (search-text) | `src/rest-core/parsers/parse-search.js`                                                       | filename                                                                            |
| `parse-filter.d.ts` (search-text)                     | `parse-search.d.ts`                                                                           | filename                                                                            |
| Error strings: `f-filter 'in' on '<field>'`           | `filter 'in' on '<field>'`                                                                    | adapter.js:1040,1046; comments                                                      |
| Comments / JSDoc referring to `f-filter` / `fFilter`  | same as code rename; URL-grammar mentions (`?f-<field>-<op>=`) stay verbatim per Q10 Option X | many                                                                                |

**Filename collision note.** `parse-filter.js` already exists (the search-text parser). Rename order: first move the existing `parse-filter.*` → `parse-search.*`, then rename `parse-f-filter.*` → `parse-filter.*`. Keeps git history readable via `git mv`.

**URL grammar changes.** Per Q10 Option W, the REST URL prefix flips from `?f-<field>-<op>=` to `?<op>-<field>=`. Parser implementation changes alongside the rename: left-anchored regex split instead of right-anchored last-dash split. Error messages drop the `f-filter` framing cleanly.

**Q8 (resolved).** Option B, with the full identifier cascade above.

**Q9 (resolved).** Option D — single `value` knob, polymorphic by op (TS discriminated union on `op`). One spelling; no `values` / `arg` / xor-pair.

**Q10 (open).** REST URL prefix after the option rename.

**Reserved top-level query params today** (`src/rest-core/`):

| Param                              | → module option                            | Source                                                   |
| ---------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `?fields=`                         | `options.fields`                           | `parse-fields.js`                                        |
| `?sort=`                           | `options.sort`                             | `parse-sort.js`                                          |
| `?filter=`                         | `options.filter` (→ `search` post-rename)  | `parse-filter.js`                                        |
| `?offset=` / `?limit=` / `?total=` | `options.offset` / `limit` / `total`       | `parse-paging.js` (names configurable via `policy.keys`) |
| `?consistent=`                     | `options.consistent`                       | `parse-flag.js`                                          |
| `?f-<field>-<op>=`                 | `options.fFilter` (→ `filter` post-rename) | `parse-f-filter.js`                                      |

**How `f-*` parses** (concrete, from `parse-f-filter.js`):

- `?f-year-eq=2024` → `{field: 'year', op: 'eq', values: ['2024']}`
- `?f-status-in=available,rented` → `{field: 'status', op: 'in', values: [...]}`
- `?f-rental-name-eq=Hertz` → field `rental-name` + op `eq` (right-anchored split against a closed op set, so field names may contain dashes)
- `?f-price-btw=$100$500` → first-char delimiter (the `first-char-delimiter-multivalue` rule)

**The collision risk.** These reserved param names share the global `?name=value` namespace with user field names. Without a prefix, `?fields-eq=…` would be ambiguous (filter on a field named `fields`, or parse error on the reserved `fields` param?). The `f-` prefix is the namespace guard: `f-*` is always filter, rest is protocol. Adding a reserved name later (e.g., `?consistent=` in 3.1.1) can't collide with user filter grammars.

**Four options considered.**

- **W.** Verb-first: `?<op>-<field>=<args>` → `?eq-year=2024&in-status=available,rented`. Parser gates on `/^(eq|ne|lt|le|gt|ge|in|btw|beg|ct|ex|nx)-/`, left-anchored split at the first `-` after the op match.
  - _Pros:_ natural English reading; no opaque meta-letter; op-grouped visual scan; single anchored regex; closed op set gives a stable namespace claim; field names no longer restricted from starting with the meta-letter.
  - _Cons:_ namespace guard becomes 12 op-prefixes instead of 1, so each new reserved top-level param must be checked against all of them (silent misparse risk if a future reserved name starts with `eq-`, `in-`, `ex-`, …); less common than field-first conventions (Django `__gte`, Sequelize `[gte]`, JSON:API extensions); same-field filters scatter (`?ge-year=…&le-year=…` repeats the field); loses the unmistakable family marker for eyeballing URLs; adapter option (`filter`) no longer echoed in the URL.
- **X.** Keep `f-*` as-is. Module option is `filter`; URL prefix stays `f-`. One-letter mnemonic mismatch, but URL grammar is a _cross-client external contract_ — cheap to keep stable, expensive to break.
- **Y.** Rename URL prefix to match (`?filter-year-eq=2024` / `?q-year-eq=2024`). Longer, and `q-` conventionally means "search query" in other APIs.
- **Z.** Drop the prefix (`?year-eq=2024`). Cleanest but every reserved name becomes a collision risk; adding future reserved params breaks existing URLs.

### Decision (2026-04-22)

**Option W — verb-first `?<op>-<field>=<value>`.**

- URL grammar becomes `?eq-year=2024&in-status=available,rented&btw-price=$100$500`.
- Parser: left-anchored, `/^(eq|ne|lt|le|gt|ge|in|btw|beg|ct|ex|nx)-(.+)$/`. ~3 lines vs. 6.
- Dashed field names handled naturally (`?eq-rental-name=Dallas` → field `rental-name`).
- Misparse risk accepted. Rationale: the REST API is developer-consumed via URL builders and templated fetches, not hand-typed by end users. Bare URL params like `?in-progress=true` don't appear in practice — clients build URLs programmatically with explicit op prefixes. The `applyFilter` allowlist guard catches any unexpected field names loudly.
- Reserved-name rule: no future top-level reserved param may start with a registered op prefix (`eq-`, `ne-`, `lt-`, `le-`, `gt-`, `ge-`, `in-`, `btw-`, `beg-`, `ct-`, `ex-`, `nx-`). Doc note + CI test when adding new reserved params.

**Q10 (resolved).**

---

## F6 — Marshalling should be wired into the adapter

**Observation.** The current example imports `marshallDateISO` / `unmarshallDateISO` at the top of `run.js` and calls them manually in one demo section. The adapter's prepare hook stamps `_createdAt` by calling `new Date().toISOString()` inline — which works but doesn't exercise the marshalling facility.

**Current state.** The `dynamodb-toolkit/marshalling` subpath exports stateless transform pairs (`marshallDateISO` / `unmarshallDateISO`, `marshallDateEpoch` / `unmarshallDateEpoch`, `marshallMap`, `marshallURL`). No adapter-level wiring exists. Users write their own prepare/revive hooks and call the marshaller inside.

**Gap.** There's no registry like `marshal: {createdAt: 'dateISO', homepage: 'url', tags: {kind: 'map', valueMarshaller: 'dateEpoch'}}` that the adapter applies automatically on prepare/revive. That registry showed up in the v3 design notes but never landed.

**Proposal — minimum move for 3.7.0.** Wire the car-rental adapter through the existing marshallers so the example demonstrates the intended pattern _without_ building the registry yet:

```js
import {marshallers} from 'dynamodb-toolkit/marshalling';

hooks: {
  prepare: (item, isPatch) => {
    if (isPatch || item._createdAt) return item;
    return {...item, _createdAt: marshallers.dateISO.marshall(new Date())};
  },
  revive: item => {
    if (item._createdAt && typeof item._createdAt === 'string') {
      return {...item, _createdAt: marshallers.dateISO.unmarshall(item._createdAt)};
    }
    return item;
  }
}
```

Verdict: hand-written; better than importing the raw functions ad-hoc but still boilerplate.

**Proposal — 3.7.0 or 3.8.0: the registry.** Add `options.marshal` to the Adapter:

```js
marshal: {
  _createdAt: 'dateISO',          // built-in
  homepage: 'url',
  schedule: {kind: 'map', valueKind: 'dateEpoch'},
  weight: {marshall: x => …, unmarshall: x => …},  // inline custom
}
```

The built-in prepare/revive steps (the ones that already run before user hooks when `technicalPrefix` is set) would apply the registry first. Questions this opens:

- **Q11.** Should the registry be a map of `field → marshallerName`, or support per-type defaults (e.g., "any `Date` instance gets `dateISO`")? The former is explicit and predictable; the latter feels magical and runs into "what if the user wants epoch for one field and ISO for another".
- **Q12.** Does the registry replace the need for user hooks to touch marshalling at all, or do we keep them as a composition layer on top? (My lean: registry runs first; user hook still gets the final word.)
- **Q13.** If the registry lands, do `stampCreatedAtISO()` / `stampCreatedAtEpoch()` from E3 still make sense? Arguably the registry subsumes E3 — declare `_createdAt: 'dateISO'` and let the built-in prepare stamp on first insert.

### Decision (2026-04-22)

**Two-stage, approved.**

- **Stage 1 — 3.7.0.** Wire the car-rental example through the existing per-field `marshall*` / `unmarshall*` helpers. No new toolkit surface. Demonstrates the intended pattern.
- **Stage 2 — deferred.** Registry proper moves to its own design doc at `dev-docs/marshalling-registry.md`. Eugene prefers **automatic application** (the built-in prepare/revive steps apply the registry; user hooks don't touch marshalling unless they want to). Eugene will add a sketch there; questions Q11–Q13 move to that doc. Ship when the design is pinned — not on the 3.7.0 clock.

---

## F7 — TypeScript counterparts

**Observation.** Want `examples/car-rental/adapter.ts` + `run.ts` to verify the TS story on the same example.

**Current state.** The toolkit has hand-written `.d.ts` sidecars per the standing rule (memory: JSDoc on every exported symbol). The adapter types live in `types/adapter.d.ts` and friends. No TS example exists.

**Proposal.**

- Add `examples/car-rental/adapter.ts` + `run.ts` alongside the `.js` files. Same logic, TS-idiomatic surface.
- Keep them **runnable independently** — either via `tsx` (devDependency) or by adding a tiny build step in the example README. `tsx` is the lowest-friction option and matches how most users run TS examples today.
- Compile-check them as part of the repo's `ts-check` script (already in the "run every check" rule from memory).

**What this will surface.**

- Whether `Adapter<TItem, TKey>` infers `TKey` correctly from `keyFields`. (Known open issue in the queue.)
- Whether the shorthand proposals from F2 work with TS (e.g., `keyFields: ['state', 'facility', 'vehicle']` needs `as const` for TS to keep the literal tuple).
- Whether `buildKey(values, options)` gives good IDE completion for `values`.
- Whether `filterable` entries get type-checked against `TItem`.

**Q14.** Should the TS examples use strict typing (`TItem` fully defined, unions for car vs. boat), or match the loose-object style of the JS example? My lean: strict — the whole point is to test the TS story.

**Q15.** `tsx` as a devDependency, or use `node --import tsx/esm`? The latter avoids adding a dep for a single example. Either way, the main toolkit stays zero-dep.

---

## F8 — GSI/LSI exercise

**Observation.** The example _declares_ `by-status-createdAt` (GSI) and `by-price` (LSI) but doesn't actually query either. Are they being auto-selected? Do users have to name them explicitly?

**Current state.**

- `adapter.getList(options, example, index)` takes an explicit `index` argument. If the caller passes it, that's the index used.
- There's an auto-selection routine (`findIndexBySortField`, adapter.js:1086) that picks an index when the caller specifies a sort field that matches an index's `sk`. Preference: LSI over GSI when both match. Throws `NoIndexForSortField` if nothing matches.
- Nothing auto-selects based on `filterable` / partition-key hints — the sort field is the only signal.

So today, `adapter.getList({sort: 'dailyPriceCents'}, {state: 'TX'})` would auto-pick `by-price` (LSI). `adapter.getList({sort: '_createdAt'}, {status: 'rented'})` would need to use the GSI, but since `status` isn't the base-table pk, it has to go explicit.

**Gap in the example.** No `§GSI query` / `§LSI query` section.

**Proposal.** Add two sections to `run.js`:

```js
// LSI auto-selected by sort key
header('§LSI — by-price auto-selected when sorting by dailyPriceCents within TX');
const sortedByPrice = await adapter.getList({sort: 'dailyPriceCents', limit: 10}, {state: 'TX'});

// GSI — explicit index name
header('§GSI — by-status-createdAt cross-partition scan for rented vehicles');
const rented = await adapter.getList({sort: '_createdAt', limit: 10}, {status: 'rented'}, 'by-status-createdAt');
```

**Q16.** Should the GSI query also be auto-selected when the example hash-field (`status`) matches an index `pk`? Today it's sort-key-only. Arguably the most useful auto-selection is "match both pk and sk when the caller supplies both" — but that's a broader design discussion (auto-route vs. explicit-route).

**Q17.** `adapter.buildKey({indexName: '…'})` is currently rejected with "not yet supported" (adapter.js:715). Should that land alongside the GSI/LSI example, or stay parked? Landing it would give `buildKey` a first-class role for secondary-index queries.

---

## F9 — `{kind, partial}` verbosity on `buildKey`

**Observation.** Current call shape:

```js
adapter.buildKey({state: 'TX'}, {kind: 'exact'});
adapter.buildKey({state: 'TX'}, {kind: 'children'});
adapter.buildKey({state: 'TX', facility: 'Dal'}, {kind: 'partial', partial: 'lla'}); // ?
```

The `kind: 'partial'` + separate `partial: '…'` string is redundant (the partial string is the _whole_ signal). And `kind: 'exact'` on a list operation doesn't make semantic sense — "exact" gets you zero-or-one record; not a list pattern.

User's proposal: list operations default to **children**; three cases total:

1. **Children** (default) — descendants only.
2. **Partial prefix match** — `{partial: 'abc'}` enables this; no `kind` needed.
3. **Self + children** — `{self: true}` returns the parent record alongside its descendants.

**Current state — all uses of `buildKey`.**

```
adapter.js:1447  this.buildKey(fromExample, {kind: options?.kind || 'children'})
adapter.js:1458  this.buildKey(fromExample, {kind: options?.kind || 'children'})
adapter.js:1643  this.buildKey(srcKey, {kind: 'children'})
adapter.js:1678  this.buildKey(srcKey, {kind: 'children'})
adapter.js:1708  this.buildKey(srcKey, {kind: 'children'})
```

Every internal caller uses `children`. The only `exact` callers are in `run.js` (the walkthrough) and the test suite — and there it's used to build a `KeyConditionExpression` for a **Query** against a full exact key, which is the degenerate "get-by-key-via-query" that isn't actually useful (callers would use `getByKey` instead). So `exact` on `buildKey` has effectively zero load-bearing use cases.

**Analysis of user's proposal.**

- **Children as default** — aligns with every internal caller. Good.
- **`partial: 'abc'` alone is sufficient** — collapses the `{kind: 'partial', partial: 'abc'}` duplication cleanly.
- **`self: true`** — this is a new capability. DynamoDB doesn't have a single Query that returns "this exact pk/sk row + all rows with sk > it". Implementing "self + children" requires either:
  - Two Queries fused at the adapter layer (one exact, one begins_with), or
  - A begins_with on a shorter prefix that happens to include the self row.

  Option (a) is the honest one; option (b) only works when the structural separator guarantees the self row's sk is a prefix of all descendants' sks (which _is_ true for our `state|facility|…` scheme — `"TX"` is a prefix of `"TX|Dallas|VIN"`).

  **Catch.** `buildKey` today returns a `{KeyConditionExpression, …}` params object meant to be spread into a single `QueryCommand`. `self: true` either (a) changes the return type to an array of two param sets, or (b) returns a single `begins_with` with a carefully chosen prefix that includes the self row.

  Option (b) is cleaner but subtle — `{state: 'TX'}` with `self: true` means the sort-key condition is `begins_with(_sk, 'TX')` (no trailing separator). That includes the state row (sk = `"TX"`) AND all descendants (sk = `"TX|…"`). It works as long as no other `state` value is a prefix of `'TX'` (i.e., no state named `T`). Since users declare state names, they own that constraint — but we'd want a validation check when declarations could collide.

- **Root-level list** (`buildKey({})` / `buildKey()` / `buildKey(null)`) — today `buildKey` rejects empty values with "at least the partition keyField must be present" (adapter.js:746). A root-level list ("give me every state-tier record") would bypass `KeyConditionExpression` entirely — it's a **Scan** with a FilterExpression on `attribute_not_exists(facility)` (or similar), not a Query. That's a different operation; the adapter should probably route differently.

**Proposal.** Land the simplification; stage the new capability.

### Stage 1 — 3.7.0 simplification (non-breaking shorthand + deprecations)

```js
// Children (default) — no options needed
adapter.buildKey({state: 'TX'});
adapter.buildKey({state: 'TX', facility: 'Dallas'});

// Partial prefix — presence of `partial` is the signal
adapter.buildKey({state: 'TX', facility: 'Dal'}, {partial: 'las'});

// Self + children — new, opt-in
adapter.buildKey({state: 'TX'}, {self: true});
```

- `{kind: 'children'}` continues to work but is a no-op (default).
- `{kind: 'partial', partial: 'x'}` continues to work; `{partial: 'x'}` alone becomes the idiomatic form.
- `{kind: 'exact'}` is soft-deprecated with a `console.warn` ("use `getByKey` for single-record reads; `buildKey` is for list operations"). Removed in 4.0.
- `{self: true}` lands as new capability via the "begins_with shorter prefix" trick (option b above); document the collision constraint.

### Stage 2 — 3.7.0 or later: root-level lists

Probably a separate method: `adapter.buildRootKey()` or `adapter.listAll()`, because it's a Scan, not a Query. Bundling into `buildKey({})` muddies the contract that `buildKey` returns Query params.

### Decision (2026-04-22)

**Stage 1 simplification approved for 3.7.0.**

- Default to children; `{kind: 'children'}` becomes the implicit default.
- `{partial: 'abc'}` alone triggers partial matching; `{kind: 'partial'}` is dropped.
- `{kind: 'exact'}` is removed outright — no real callers, `getByKey` covers the single-record case.
- `{self: true}` lands as a new capability via the begins_with-shorter-prefix trick.

No deprecation shims — break straight through.

**Q18 (resolved).** `buildKey` = list / query contract. `kind: 'exact'` removed.

**Q19 (open).** Add the prefix-collision validation check at Adapter construction? I'd land it — cheap, prevents a subtle footgun for `{self: true}`. _Defer to implementation; flag if it turns out to be noisy._

**Q20 (open).** Root-level list shape — separate method (`listAll` / `buildRootKey`) vs. overload `buildKey()`. _Holding — not blocking 3.7.0 Stage 1; revisit when a real use case surfaces._

---

## F10 — Tier-aware sparse indexing

**Observation.** DynamoDB has no native "list all records of type X" across partitions. SQL users reach for `SELECT * FROM table WHERE type='state'` and find nothing equivalent. The canonical DynamoDB answer — a sparse secondary index on a tier/type marker attribute — is only canonical to people who've learned the DynamoDB vernacular. Toolkit users coming from SQL don't.

**Current state.**

- `typeDiscriminator` is read-only (adapter.js:583). Users write `kind: 'car'` themselves; the toolkit never populates it.
- `typeLabels` is read-only too — used for depth-based labeling in `typeOf`, not materialized into the record.
- No built-in prepare step writes a tier/type attribute.
- Sparse GSI/LSI declarations work today — the gap is only in populating the indexed attribute automatically.

**Three patterns worth documenting in the wiki.**

### Pattern 1 — Single sparse GSI on an auto-populated `typeField`

Add `typeField: 'kind'` to the declaration; the built-in prepare step writes it on every record based on `typeOf(item)` (depth for non-leaf tiers, discriminator override at leaf if user sets one). Then:

```js
indices: {
  'by-kind': {
    type: 'gsi',
    pk: {name: 'kind', type: 'string'},
    sk: {name: '_sk', type: 'string'},
    projection: 'all'
  }
}
```

- All states: `Query by-kind where kind = 'state'`.
- All facilities in TX: `Query by-kind where kind = 'facility' AND begins_with(_sk, 'TX|')`.
- All cars globally: `Query by-kind where kind = 'car'`.

**Cost:** full GSI replication. Hot-partition risk at leaf tier (millions of vehicles in one partition). Mitigate with sharded pk (`kind#<hash>`) + scatter-gather.

### Pattern 2 — Per-tier sparse GSI with dedicated markers

One sparse GSI per tier that needs cross-partition answers. The built-in prepare writes tier-specific markers:

- State records get `_stateMarker: 'Y'` (only state records carry it).
- Facility records get `_facilityMarker: 'Y'`.
- Leaf records get no marker.

```js
indices: {
  'all-states':     {type: 'gsi', pk: {name: '_stateMarker',    type: 'string'}, sk: {name: 'state', type: 'string'}, projection: 'keys-only'},
  'all-facilities': {type: 'gsi', pk: {name: '_facilityMarker', type: 'string'}, sk: {name: '_sk',   type: 'string'}, projection: 'keys-only'}
}
```

- Smaller sparse GSIs (tier-scoped rows only).
- Hot-partition: all rows of a tier under one marker value. Fine for states (~50), risky for facilities (~thousands), unworkable for leaves (~millions).
- `keys-only` projection + `BatchGetItem` follow-up keeps RCU controlled.

### Pattern 3 — Sparse LSI for within-partition tier filtering

When the question is "facilities in TX" (same partition, different tier), LSI is free-ish — shares the base partition, adds one sort-key.

```js
indices: {
  'by-facility-in-state': {
    type: 'lsi',
    sk: {name: '_facilityMarker', type: 'string'},
    projection: 'keys-only'
  }
}
```

- `Query by-facility-in-state where state = 'TX'` returns facility records under TX only.
- LSI is additive on the base partition; cross-partition queries need a GSI (Pattern 1 or 2).

**Proposal for 3.7.0.**

Add `typeField` to the Adapter declaration surface. Additive-presence clean:

```js
typeField: 'kind',          // presence triggers auto-write on prepare
typeLabels: ['state', 'facility', 'vehicle'],
typeDiscriminator: 'kind',  // same field name — reads what the built-in wrote
```

- Presence of `typeField` turns on the auto-write; absence means "I'll populate it myself" (today's behavior).
- Built-in prepare writes `kind = typeOf(item)` on every record. If the user has already set the field (e.g., `kind: 'car'`), it wins (same resolution as `typeOf` today).
- `typeDiscriminator` stays read-only — it just happens to read the same field the built-in wrote.
- Pattern 2's `_stateMarker` / `_facilityMarker` auto-write is optional, behind a separate declaration (e.g., `tierMarkers: ['state', 'facility']` — opt-in list of tiers to materialize markers for). Deferred until a user needs it.

**Wiki work.** Per the recipe-book positioning, each of the three patterns above gets a dedicated wiki page with:

- The user-facing question ("how do I list every state record?").
- The declaration snippet.
- The wire-level Query shape.
- Cost and hot-partition trade-offs.
- Sharded-marker variant for scale.

### Decision (2026-04-22)

**Approved for 3.7.0.**

- Add `typeField` auto-populate on prepare (Pattern 1 enabler).
- Ship Pattern 1 / 2 / 3 as wiki recipes — mandatory pedagogical content, not optional.
- Defer sharded-marker variant (Pattern 1 scaled) until a concrete scale request surfaces.
- Defer per-tier `tierMarkers` (Pattern 2 enabler) until a user hits Pattern 1's leaf hot-partition.

---

## Cross-cutting — what lands where?

**3.7.0 (all breaking changes approved; no deprecation shims).**

| Item                                                                                                                                                      | Source       | Status                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------- |
| Single `value` knob, polymorphic by op (Option D); drop `values`                                                                                          | E1 + F5 + Q9 | decided                               |
| Hide descriptor record from scans                                                                                                                         | E2           | decided                               |
| `stampCreatedAtISO` / `stampCreatedAtEpoch` hook builders                                                                                                 | E3           | decided — revisit when registry lands |
| `adapter.getListUnder(partialKey, options)` sugar                                                                                                         | E5           | decided                               |
| `filterable` optional `type:` for coercion                                                                                                                | E6           | decided                               |
| Split `ensureTable` into `planTable()` (read-only) + `ensureTable()` (mutating); drop `{yes}` / `{dryRun}` options; CLI mirrors                           | F1           | **decided**                           |
| Shorthand `typeDiscriminator: 'kind'` / `structuralKey: '_sk'`                                                                                            | F2           | decided                               |
| Car-rental example: tier-1/tier-2 records (states + facilities)                                                                                           | F3           | decided (example only)                |
| Car-rental example: bulk-load section via `putItems`                                                                                                      | F4           | decided (example only)                |
| Rename `fFilter` → `filter`; current `filter` → `search` (Option B); full identifier cascade (`applyFFilter`, `parseFFilter`, `FFilterClause`, filenames) | F5           | **decided**                           |
| Marshalling wired into example via existing per-field helpers (Stage 1)                                                                                   | F6           | **decided**                           |
| `adapter.ts` / `run.ts`                                                                                                                                   | F7           | decided                               |
| GSI/LSI sections in example                                                                                                                               | F8           | decided                               |
| `buildKey` simplification (default children; `{partial}` alone; `{self}`; drop `kind: 'exact'`)                                                           | F9 Stage 1   | **decided**                           |
| `typeField` auto-populate on prepare (Pattern 1 enabler) + wiki recipes for tier-filtering patterns 1/2/3                                                 | F10          | **decided**                           |

**Deferred (separate design doc).**

- Marshalling registry proper → `dev-docs/marshalling-registry.md` (Eugene's sketch pending).
- Root-level list method (F9 Stage 2) — revisit when use case surfaces.
- Multi-Adapter shared-table dispatch (Q13 from hierarchical design) — still no use case.
- Sharded-marker variant for leaf-tier scale (F10 Pattern 1) — revisit at first hot-partition report.
- Per-tier `tierMarkers` auto-write (F10 Pattern 2 enabler) — revisit when Pattern 1 isn't enough.

**Release framing.** 3.7.0 is a breaking minor. 4.0 is held back for when the API stabilizes — not this cycle.

---

## Open questions — status

**Resolved (2026-04-22).**

- `Q1` ensureTable default flip — **superseded by F1 split**: `planTable()` + `ensureTable()`; no flag at all.
- `Q2` dry-run no-op output — **closed by F1 split**: `planTable()` on a no-op returns steps=[] with a human-readable summary; CLI prints unconditionally.
- `Q8` fFilter rename — **Option B decided**: `fFilter` → `filter`, current `filter` → `search`.
- `Q9` clause shape — **Option D decided**: single `value` knob, polymorphic by op; TS discriminated union narrows per op.
- `Q10` REST URL prefix — **Option W decided**: `?<op>-<field>=<value>` (verb-first). Parser rewrite: left-anchored regex. Reserved-name rule + CI test gate future param additions.
- `Q18` `buildKey` = list-only contract — **decided**: yes; `kind: 'exact'` removed.
- `Q21` 3.7.0 scope — **decided**: everything in 3.7.0; no 4.0 yet.
- `Q11`–`Q13` (marshal registry shape, ordering, E3 subsumption) — **moved** to `dev-docs/marshalling-registry.md`.

**Holding (low stakes; defer to implementation time).**

- `Q3` default separator for `structuralKey` shorthand (lean `|`)
- `Q4` `structuralKey: true` fully-auto form
- `Q5` typed validation hooks in the example
- `Q6` `putItems` vs. `writeItems` recommendation (lean `putItems`)
- `Q7` streaming seed scope (lean: not now)
- `Q14` TS example strictness (lean strict)
- `Q15` `tsx` as devDep vs. loader flag (lean loader flag)
- `Q16` GSI auto-selection when pk matches (lean: not now; explicit index name stays)
- `Q17` `buildKey({indexName})` activation (lean: land alongside F8 example work)
- `Q19` prefix-collision validation at construction (lean: land)
- `Q20` root-level list method shape (defer until use case)
