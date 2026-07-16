# Architecture — dynamodb-toolkit (v3)

Internal layout and design notes for maintainers. Consumer-facing docs live in the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki); the machine-readable API reference is in `llms.txt` / `llms-full.txt`.

## Shape

ESM-only JavaScript with hand-written `.d.ts` sidecars next to every `.js` — no build step, no transpiler. Zero runtime dependencies; the AWS SDK v3 packages (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`) are peer dependencies. Each `.js` carries a `// @ts-self-types="./<file>.d.ts"` directive so its sibling `.d.ts` is the sole source of types and docs; `.js` files hold no JSDoc beyond load-bearing inline `/** @type */` / `/** @returns */` annotations the implementation needs to type-check.

Every module is an independent entry in the `package.json` `exports` map, importable without instantiating `Adapter`. The folder entries (`./expressions`, `./batch`, `./mass`, `./paths`, `./rest-core`, `./handler`, `./marshalling`, `./provisioning`, `./express`, `./koa`, `./fetch`, `./lambda`) resolve to a barrel `index.js`; everything else routes through the identity wildcard `./*` → `./src/*`.

## Composition root

`Adapter` (`src/adapter/`) is the composition root. It owns long-lived state — `client`, `table`, the declarative schema, and the `hooks` bag — and delegates real work to the orthogonal sub-export modules. An Adapter declared with only `{client, table, keyFields}` behaves exactly like the pre-3.2 line: single pk, identity hooks, no built-in steps. Every declarative option below is opt-in and additive.

### Declarative schema (3.2–3.7)

- **Composite keys** — `keyFields: [{name, type, width?}, ...]` + `structuralKey: {name, separator?}`. Built-in `prepare` composes the joined sort-key attribute on writes; built-in `prepareKey` composes it on reads. `width` is required on `{type: 'number'}` components (zero-padding preserves lexicographic order).
- **Indices** — `indices: {<name>: {type: 'gsi'|'lsi', pk?, sk?, projection?, sparse?, indirect?}}` (supersedes the legacy `indirectIndices` shorthand, still normalised into this shape). `sparse: true | {onlyWhen}` declares sparse-by-absence; `indirect: true` triggers the second-hop `BatchGetItem` pattern on keys-only GSIs.
- **Type tags** — `typeLabels`, `typeDiscriminator`, `typeField`. `adapter.typeOf(item)` resolves via discriminator → depth-based label → depth number; `typeField` + built-in prepare auto-stamps it on every full write.
- **Technical prefix** — `technicalPrefix`. Built-in `prepare` rejects user items intruding into the prefixed namespace; built-in `revive` strips prefixed fields (except `versionField` / `createdAtField`, which round-trip).
- **Filterable allowlist** — `filterable: {<field>: [...ops] | {ops, type}}`. `adapter.applyFilter(params, clauses)` compiles parsed `<op>-<field>=<value>` URL clauses, auto-promoting index-compatible clauses to `KeyConditionExpression`.
- **Searchable mirrors** — `searchable` + `searchablePrefix`. Built-in `prepare` writes `<prefix>field = lowercase(value)`; `?search=X` runs a substring filter over the mirrors.
- **Optimistic concurrency** — `versionField`. Auto-init to `1` on `post`, auto-bump on writes, auto-condition on `put`/`patch`/`edit`. Mass-op `editListByParams` buckets version-mismatch conflicts into `MassOpResult.conflicts`.
- **Scope-freeze** — `createdAtField`. Enables `options.asOf` on mass ops (AND-merges `<field> <= :asOf` into the scan FilterExpression). The toolkit does not auto-write the field — wire `stampCreatedAtISO` / `stampCreatedAtEpoch` into a user `prepare`.
- **Cascade** — `relationships: {structural: true}` gates `deleteAllUnder` / `cloneAllUnder[By]` / `moveAllUnder[By]` (leaf-first / root-first / two-phase-idempotent pagination over the shared mass-op envelope).
- **Descriptor record** — `descriptorKey`. Provisioning writes a JSON snapshot of the declaration at this reserved row; `verifyTable` diffs it for drift `DescribeTable` can't see. Auto-filtered from list ops.

## Modules

| Module                             | Responsibility                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expressions/`                     | `Update` / `Projection` / `Filter` / `Condition` / `KeyCondition` expression builders. Each allocates per-prefix counter-based aliases so composing builders on the same `params` is collision-safe.                                                                                                                                                                                                 |
| `batch/`                           | Chunked `BatchWriteItem` (25/call), single `TransactWriteItems` (100/call), `BatchGetItem` (100/call), `TransactGetItems`. `explainTransactionCancellation` maps `CancellationReasons` back to input descriptors. `backoff(from=50, to=20_000, finite?)` — AWS "stop around one minute" default.                                                                                                     |
| `mass/`                            | Paginated reads, bulk-individual reads/writes/deletes (caller-supplied set), and list-op reads/writes/deletes (DB-produces set). Resumable list-op variants return `MassOpResult` `{processed, skipped, failed, conflicts, cursor?}`. Naming: "List" means DB-produces-set; bulk-individual helpers drop it.                                                                                         |
| `paths/`                           | Nested get/set/delete/patch on plain objects. Prototype-safe (rejects `__proto__` / `constructor` / `prototype` segments).                                                                                                                                                                                                                                                                           |
| `rest-core/`                       | Framework-agnostic REST primitives: parsers, builders, policy. DoS-gated (`parsePaging.maxOffset` 100k, `parseFields/Names.maxItems` 1000, `parseSearch.maxLength` 1024, `validateWriteBody`, null-prototype accumulators). `parseFilter` (Option W): `?<op>-<field>=<value>`, ops `eq ne lt le gt ge in btw beg ct ex nx`.                                                                          |
| `handler/`                         | `node:http` `(req, res)` handler over rest-core. `HEAD → GET` auto-promote, byte-accurate `maxBodyBytes` (1 MiB default), streaming `readJsonBody`.                                                                                                                                                                                                                                                  |
| `http/{express,koa,fetch,lambda}/` | Framework adapters over rest-core + `matchRoute` — same wire contract as `handler/`, translated per framework. Frameworks are duck-typed at runtime (zero deps; `express` / `koa` / `aws-lambda` types are devDeps only). Public subpaths stay short (`dynamodb-toolkit/express` → `src/http/express/`). `http/lambda/local.js` adds `createNodeListener` / `createFetchBridge` local-debug bridges. |
| `hooks/`                           | `stampCreatedAtISO` / `stampCreatedAtEpoch` prepare-hook factories (first-insert only; patches and round-tripped reads untouched). Re-exported from the root.                                                                                                                                                                                                                                        |
| `marshalling/`                     | `Marshaller<TRuntime, TStored>` pairs: `dateISO`, `dateEpoch`, `url`, plus `marshallMap` / `unmarshallMap`. Undefined / null pass through.                                                                                                                                                                                                                                                           |
| `provisioning/`                    | ADD-only table lifecycle: `planTable` (read-only), `ensureTable` (plan + apply), `verifyTable` (diff + optional throw), descriptor read/write. IaC-agnostic; absent descriptor is neutral by default.                                                                                                                                                                                                |

## Write path

- Every single-op write funnels through `dispatchWrite(client, batch, checks)` (`src/adapter/transaction-upgrade.js`): build descriptor → `hooks.checkConsistency(batch)` → `null` means single-Command fast path; any array (even `[]`) upgrades to `TransactWriteItems` with the main op plus the returned descriptors. Combined count > `TRANSACTION_LIMIT` (100) → `TransactionLimitExceededError`.
- Every `make*` builder returns a discriminated `BatchDescriptor` — `{action: 'get'|'check'|'put'|'patch'|'delete', params}` (plus `adapter` on `makeGet`) — composable with `applyTransaction` / `applyBatch` / `getBatch` / `getTransaction`.
- Built-in `prepare` / `prepareKey` steps run before user hooks when their declarative options are set.

## Read path

- **Indirect indices** — a keys-only GSI with `indirect: true` Queries the GSI for base-table keys, then `BatchGetItem`s the base table with the caller's `fields` projection. Per-call opt-out via `{ignoreIndirection: true}`.
- **`adapter.buildKey(values, {self?, partial?}?, params?)`** — `KeyConditionExpression` builder for hierarchical queries. Default children-only; `{self: true}` adds the row at `values`; `{partial: 'X'}` narrows the next tier. Requires composite `keyFields` + `structuralKey` for `{self}` / `{partial}`.
- **`Raw<T>`** is the bypass marker. On writes it skips built-in prepare + user `prepare` + `validateItem`; on reads with `{reviveItems: false}`, results come back wrapped in `Raw<T>`.

## Extension points

User hooks compose **around** the built-in steps — the built-in runs first, the user hook sees its output. Pass via the constructor `options.hooks` or override the method on a subclass.

| Hook                                | Default                         | When                                                                                               |
| ----------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `prepare(item, isPatch?)`           | identity                        | Before every non-`Raw` write (after built-in mirrors / structural key / typeField / version init). |
| `prepareKey(key, index?)`           | identity                        | Before every keyed op (after built-in structural-key composition).                                 |
| `prepareListInput(example, index?)` | `() => ({})`                    | Extra DynamoDB params for list / scan / query.                                                     |
| `updateInput(input, op)`            | identity                        | Last-chance mutation of the SDK Command input before dispatch.                                     |
| `revive(rawItem, fields?)`          | `subsetObject(rawItem, fields)` | After every read (after built-in technical-prefix strip).                                          |
| `validateItem(item, isPatch?)`      | `async () => {}`                | Async validator; throw to abort the write. Skipped for `Raw<T>`.                                   |
| `checkConsistency(batch)`           | `async () => null`              | Returns extra `make*` descriptors to bundle in the same `TransactWriteItems`.                      |

## Errors

All domain errors extend `ToolkitError` (which extends `Error`); `err.name` matches the class name for non-`instanceof` discrimination, and some carry `.status` to short-circuit the REST handler's error mapping. The set: `ConsistentReadOnGSIRejected`, `NoIndexForSortField`, `BadFilterField`, `BadFilterOp`, `KeyFieldChanged`, `CreatedAtFieldNotDeclared`, `CascadeNotDeclared`, `TableVerificationFailed`, `TransactionLimitExceededError`.

## Layout

```
src/                    # Published code (ESM .js + .d.ts sidecars)
  index.js              # Main entry — re-exports Adapter, Raw/raw, stamp* hooks, errors, sleep/seq/random
  adapter/              # Adapter class, hooks composition, built-in prepare/revive/prepareKey, transaction-upgrade dispatcher
  expressions/          # Expression builders
  batch/                # Batch + transaction runners, backoff
  mass/                 # Pagination, bulk-individual + list-op read/write/delete, cursors
  paths/                # Nested-path utilities
  rest-core/            # Parsers + builders + policy
  handler/              # node:http handler
  http/                 # Framework adapters (public subpaths keep their short names)
    express/            #   createExpressAdapter — Express middleware
    koa/                #   createKoaAdapter — Koa middleware
    fetch/              #   createFetchAdapter — (Request) => Promise<Response>
    lambda/             #   createLambdaAdapter + local.js debug bridges
  hooks/                # stamp* prepare-hook factories
  marshalling/          # Marshaller pairs
  provisioning/         # Table lifecycle + descriptor record
  errors.js             # ToolkitError base + domain subclasses
  raw.js                # Raw<T> bypass marker + raw() helper
  sleep.js / seq.js / random.js
bin/                    # CLI — plan-table / ensure-table / verify-table
tests/                  # Unit + mock integration (.js), CJS smoke (.cjs), typed smoke (.ts), e2e/ (DynamoDB Local)
examples/car-rental/    # Hierarchical-use-case walkthrough (.js + .ts mirror)
wiki/                   # Published wiki — git submodule
```

The published tarball ships `src/`, `bin/`, `README.md`, `LICENSE`, `llms.txt`, `llms-full.txt`, `package.json`. Tests, AI-rule files, dev-docs, examples, and the wiki stay out (verify via `npm pack --dry-run`).
