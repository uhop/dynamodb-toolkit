# Car rental — hierarchical example

Runnable walkthrough exercising the full 3.7.0 toolkit surface against a realistic data model: a national rental agency with **state ⇒ facility ⇒ vehicle**, where each facility rents both cars AND boats and every tier carries real data (not just structural-key prefixes).

## Data model

- **Structural hierarchy**: `state | facility | vehicle`. Every tier stores records with per-tier fields:
  - **State** records — manager info (name / email / phone) and a `managedSince: Date` that demonstrates marshalling round-trip through the adapter's hooks.
  - **Facility** records — address + facility manager info.
  - **Vehicle** records at the leaf — cars (`make`, `model`, `year`) or boats (`length`, `motorHP`), both with `status` and `dailyPriceCents`.
- **Multi-type same tier**: vehicles are `kind: 'car'` or `kind: 'boat'`. The same `kind` field is auto-populated on state / facility records too (`typeField: 'kind'`), so `adapter.typeOf(item)` returns `'state'` / `'facility'` / `'car'` / `'boat'` uniformly.
- **Two index patterns**:
  - GSI `by-status-createdAt` — sparse on the `status` attribute: only vehicles (which carry `status`) appear in the index; "show me every rented vehicle across the fleet" is a cross-partition Query.
  - LSI `by-price` — within a state, sort vehicles by daily price. Auto-selected via `adapter.getList({sort: 'dailyPriceCents'})`.

## What it exercises

| Feature                                                                                                              | Where                                     |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Typed declaration with shorthands (string `keyFields` / `structuralKey: '_sk'` / `typeDiscriminator: 'kind'`)        | [`adapter.js`](./adapter.js)              |
| `typeField` auto-populate — built-in prepare stamps `kind` on every write                                            | `adapter.js` + §typeOf                    |
| `filterable` with explicit `type` override for non-keyField attributes                                               | `adapter.js` (the `year` entry) + §Filter |
| `planTable` / `ensureTable` split (read-only vs. executing) + `verifyTable` + descriptor record                      | [`run.js`](./run.js) §Setup, §verifyTable |
| `adapter.putItems` bulk-load for the whole hierarchy                                                                 | §Seed (bulk)                              |
| `adapter.buildKey` (children default, `{self}`, `{partial}`)                                                         | §Subtree queries                          |
| `adapter.getListUnder` sugar                                                                                         | §getListUnder                             |
| Filter URL grammar `?<op>-<field>=<value>` + polymorphic clause shape (`{field, op, value}`)                         | §Filter                                   |
| LSI auto-promote by sort field                                                                                       | §LSI                                      |
| GSI explicit cross-partition Query                                                                                   | §GSI                                      |
| Mass ops + cursor resume (`{maxItems, resumeToken}`)                                                                 | §Resumable mass op                        |
| `adapter.edit(key, mapFn)` + `editListByParams`                                                                      | §edit / §editListByParams                 |
| `rename(from, to)` subtree macro                                                                                     | §rename                                   |
| Cascade primitives (`deleteAllUnder`, `cloneAllUnder{,By}`, `moveAllUnder{,By}`)                                     | §Cascade                                  |
| Optimistic concurrency (`versionField`) + scope-freeze (`asOf`)                                                      | §Concurrency, §asOf                       |
| Marshalling round-trip (`marshallDateISO` / `unmarshallDateISO`) wired into the adapter's `prepare` / `revive` hooks | `adapter.js` + §Marshalling               |
| Canned `stampCreatedAtISO()` prepare-hook builder                                                                    | `adapter.js`                              |

## Run it

Requires Docker (DynamoDB Local is spun up for you):

```sh
node examples/car-rental/run.js
```

The script creates a one-off table, runs the walkthrough end-to-end, prints each step's outcome, and deletes the table when done. Skips gracefully if Docker isn't available.

## TypeScript mirror

`examples/car-rental/ts/` has a fully-typed counterpart — `adapter.ts`, `seed-data.ts`, `run.ts` — that drives the same walkthrough under a discriminated-union record type (`StateRecord | FacilityRecord | CarRecord | BoatRecord`). Run directly under Node 22.6+:

```sh
node examples/car-rental/ts/run.ts
```

Node strips the TypeScript types natively; no compile step, no extra dependency. `npm run ts-check` type-checks the TS example against the rest of the tree.

The TS mirror surfaces the ergonomic rough edges in the typed surface — all documented inline with concrete callouts:

- Record types must `extends Record<string, unknown>` to satisfy the `Adapter<TItem>` constraint, since the adapter adds `_version` / `_createdAt` / `_sk` at runtime.
- `prepare` / `revive` hooks that transform a field across the union need a single `as AnyRecord` cast — TypeScript narrows too aggressively through the spread.
- Everything else (discriminated reads via `isState` / `isCar` / `isBoat` guards, typed `putItems`, typed filter clauses, the `stampCreatedAtISO<AnyRecord>` generic) flows without further casting.

## Not covered

- Full REST server — the bundled `dynamodb-toolkit/handler` route pack is exercised by the unit tests, not in this walkthrough. Adapter packages (`dynamodb-toolkit-koa` etc.) wire it up for production use.
- Per-tier sparse-marker GSIs (Pattern 2 from the F10 recipe) and sharded leaf-tier GSIs (Pattern 1 scaled) — the single `typeField`-based GSI shown here is Pattern 1 in its simplest form. Per-tier and sharded variants land when a concrete scale need surfaces.
