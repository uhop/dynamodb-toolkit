# dynamodb-toolkit — v3 Design

> **Status:** design doc. Follows `dev-docs/v3-survey.md` (2026-04-15) and the decisions captured while that survey was reviewed.
> **Date:** 2026-04-15.
> **Posture:** green-field redesign. No back-compat with v2. v2 consumers stay on v2.

---

## 1. Scope and posture

### 1.1 Goals

- Rebuild `dynamodb-toolkit` on AWS JS SDK v3 (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` + `@aws-sdk/util-dynamodb`).
- **Preserve every good idea** the v2 toolkit accreted over 1.x → 2.3. The survey (`dev-docs/v3-survey.md` §2, §4) is the canonical inventory.
- **Reshape freely** where v2 naming, typing, or structure is dragging. Back-compat is not a constraint.
- Ship with real types (`.d.ts` sidecars) and real tests (no more manual Postman loop).

### 1.2 Non-goals

- Supporting AWS JS SDK v2.
- Dual-publishing CommonJS.
- Becoming a single-table-design ORM (ElectroDB, dynamodb-toolbox, dynamodb-onetable already fill that niche). The toolkit stays **schemaless, REST-shaped, expression-ergonomic, and mass-op-aware**.
- Owning AWS client construction, credential loading, or telemetry. Those are SDK or consumer concerns.

### 1.3 Method

For each v2 capability:

1. Find it in the survey + the code.
2. State what it solves in plain terms, independent of v2 naming.
3. Propose the v3 shape on its own merits. Deviate from v2 whenever the result is clearer.
4. Cross-check: no v2 capability is silently dropped. If a capability is dropped, the doc says so and why.

---

## 2. Invariants carried over from v2

These must survive the rewrite, even if their names and shapes change:

| # | Invariant | v2 home | Why it stays |
|---|---|---|---|
| 1 | Schemaless Adapter over one logical entity (usually a table) | `Adapter.js` | Core mental model. |
| 2 | User hooks for schema transforms: `prepare`, `revive`, `prepareKey`, `prepareListInput` (was `prepareListParams`) | `Adapter.js:58-97` | Primary extension point. On-disk shape ≠ wire shape for most non-trivial consumers. |
| 3 | Async validation and consistency hooks: `validateItem`, `checkConsistency` | `Adapter.js` | Per-project business rules; transaction auto-upgrade depends on `checkConsistency`. |
| 4 | Patch builder with dotted-path semantics (supports nested objects; pure-digit segments are array indices) | `utils/prepareUpdate.js` | DynamoDB `UpdateExpression` has no equivalent in the SDK. |
| 5 | Projection builder with attribute-name de-dup and reuse | `utils/addProjection.js` | SDK builds nothing. |
| 6 | Filter builder over searchable fields (substring, case-insensitive by default) | `utils/filtering.js`, `searchable` config | SDK builds nothing. |
| 7 | Offset + limit pagination that *accumulates* through `FilterExpression` results | `utils/paginateList.js`, `paginateListNoLimit.js` | DynamoDB's `Limit` is pre-filter; SDK paginators don't fix this. |
| 8 | Chunked `BatchWriteItem` / `BatchGetItem` / `TransactWriteItems` / `TransactGetItems` with `UnprocessedItems` / `UnprocessedKeys` retry and exponential backoff | `utils/applyBatch.js`, `applyTransaction.js`, `getBatch.js`, `getTransaction.js`, `backoff.js` | SDK's retry strategy does not resubmit unprocessed items. |
| 9 | Indirect-index second-hop pattern (GSI with key-only projection + base-table BatchGet) | `indirectIndices` config, `readOrderedListByKeys` | Unique value; saves storage on sparse GSIs. |
| 10 | Transaction auto-upgrade from single ops to `transactWriteItems` when `checkConsistency` returns extra actions | `Adapter.js` CRUD paths | Consistency guarantees without leaking transaction plumbing into the call site. |
| 11 | Mass operations: `writeList`, `deleteList`, `copyList`, `moveList`, `readList` (+ `byKeys` / `viaKeys` variants) | `utils/*List.js` | Composed primitives; consumers would otherwise write them themselves. |
| 12 | Ordered result preservation for `readListByKeys` (SDK returns `BatchGet` items in arbitrary order) | `utils/readOrderedListByKeys.js` | Small but consumer-valuable. |
| 13 | REST surface: CRUD on noun URIs, `-`-prefixed method URIs, filter + sort + fields + pagination query params, patch with meta-keys, idempotent `DELETE`, `404` on single-item miss, `{processed: N}` on mass writes | `helpers/KoaAdapter.js`, `tests/routes.js`, Postman suite | De-facto REST contract. v3 keeps the functional surface; names and codes become policy knobs. |
| 14 | Pagination envelope shape `{data, total, offset, limit}` as the default | `utils/paginateList.js:102-103`, Postman suite | Default; all envelope keys become policy knobs. |
| 15 | `needTotal: false` opt-out at the utility layer, as a **designer-time** option | `utils/paginateList.js` | Plumb through to the Adapter and per-route Koa config in v3. Not a client-facing query param. |

The capabilities listed above are **requirements** for v3. Everything else is fair game.

---

## 3. Data model and marshalling

### 3.1 One format, plain JS

The v2 toolkit exposed three data shapes (user-land, `Raw` = DocumentClient-style, `DbRaw` = raw DynamoDB envelopes) because the project predates `DocumentClient` and had to serve consumers on both paths.

v3 collapses to **one shape**: plain JS with `Set` / `Buffer` where appropriate, marshalled transparently by `@aws-sdk/lib-dynamodb` middleware. The Adapter requires a `DynamoDBDocumentClient` at construction time.

**Dropped**: `utils/converter.js`, `utils/convertTypes.js`, `specialTypes`, `isDocClient` branching, `Adapter.DbRaw`, the dual `fromDynamo` / `fromDynamoRaw` API.

**Consequences in the API:**

- No `returnRaw` tri-state. Replaced by `{reviveItems: false}` option (see §4.3) when a caller wants `prepare`/`revive` skipped on pipelined reads and writes.
- No `specialTypes` config. `new Set(...)` distinguishes `SS`/`NS`/`BS` natively via v3's `marshall`.
- No custom `Converter` injection. If a consumer needs exotic marshalling, they construct their own `DynamoDBDocumentClient` with `marshallOptions` / `unmarshallOptions` and hand it in.

### 3.2 The `Raw<T>` bypass marker

The `Raw` / `DbRaw` marker class pair from v2 collapses to a single **`Raw<T>`** brand. Purpose unchanged: "I already built this object in the DB's expected shape; don't run `prepare` / `revive` on it."

```js
import { raw } from 'dynamodb-toolkit';
await adapter.put(raw(itemFromAnotherAdapter));
```

Internal effect: when `put` / `patch` / `post` sees a `Raw` brand, it skips `prepare` and `validateItem`. When a read is requested with `{reviveItems: false}` (or through an internal pipelined path), results are returned as `Raw<T>`. Marshalling happens unconditionally — the SDK middleware runs regardless of the brand.

The `Raw` marker ships as an ES class; the brand is the class identity. A small helper `raw(x)` wraps a plain object; `x instanceof Raw` detects it.

### 3.3 Marshalling edge cases

These are SDK concerns, not toolkit concerns. The design doc records them so the wiki can cover them prominently:

- **`undefined` throws by default.** `DynamoDBDocumentClient.from(client, {marshallOptions: {removeUndefinedValues: true}})` is the v2-parity construction. The toolkit's README / wiki recommends this snippet.
- **Number precision** beyond `Number.MAX_SAFE_INTEGER` requires `wrapNumbers: true` (returns `NumberValue` instances). Typing of `Adapter<TItem>` accounts for this via the `NumberValue` re-export.
- **Empty strings** are valid in DynamoDB since 2020; no special handling needed.
- **Binary sets (`BS`)** have had historical marshalling bugs in the SDK; integration tests explicitly cover round-trip of `new Set([Uint8Array.of(...)])` items.
- **`BigInt`** unmarshalls to `BigInt`; `JSON.stringify` breaks on `BigInt` without a custom replacer. Users who store large integers handle this themselves.

**The toolkit does not re-export `marshall` / `unmarshall`.** Consumers who need them import directly from `@aws-sdk/util-dynamodb` (already on the peer-dep list indirectly via `lib-dynamodb`'s dependency; if not, document a peer-dep addition). Rationale: avoid owning an SDK shape that changes independently.

### 3.4 Schema transforms: `prepare` and `revive`

Unchanged in spirit. Default implementations are `identity` for `prepare` / `prepareListInput` and `subsetObject(rawItem, fields)` for `revive`. Signatures:

```ts
prepare(item: TItem, isPatch?: boolean): TItem;
prepareKey(key: Partial<TItem>, index?: string): Partial<TItem>;
prepareListInput(item: Partial<TItem>, index?: string): Record<string, unknown>;
revive(rawItem: TItem, fields?: string[]): TItem;
```

**Roles recap:**

- `prepare` adds **technical fields** on write (denormalized indexing, search helpers, computed partitions, tenant IDs, timestamps) and strips **transient fields** that shouldn't persist. `isPatch` distinguishes partial updates.
- `prepareKey` prepares a key-only lookup: default `= restrictKey(prepare(key), index)`.
- `prepareListInput` contributes extra params at list/scan/query time.
- `revive` strips technical fields, rebuilds calculated fields, applies field subsetting.

**v2 → v3 renames:** `prepareListParams` → `prepareListInput`; `updateParams` → `updateInput` (see §4.4). Reason: v3 Commands use `*Input` / `*Output` terminology consistently, and the greenfield posture lets us align.

**Typed:** in `adapter.d.ts`, `TItem` flows through these signatures; `revive`'s `fields?: string[]` narrows the return type via `Path<TItem>`-based conditional types (see §6).

---

## 4. Adapter

### 4.1 Shape and posture

The Adapter is a **class** in v3 (OOP), not because every helper has to go through it, but because it owns **long-lived state** that doesn't belong in a parameter: the `DynamoDBDocumentClient`, the table name, key fields, `searchable` config, `indirectIndices` map, `projectionFieldMap`, and the user hooks. Wrapping this in a class avoids threading the same seven arguments through every call site.

**But the class is thin.** The Adapter is a composition root over orthogonal function modules:

- `expressions/` — patch, projection, filter, condition builders.
- `batch/` — `applyBatch`, `applyTransaction`, `getBatch`, `getTransaction`, backoff.
- `mass/` — `writeList`, `deleteList`, `copyList`, `moveList`, `readList` family, pagination.
- `paths/` — `getPath`, `setPath`, `deletePath`, `applyPatch`, `normalizeFields`, `subsetObject`.

Each of those modules is **usable without the Adapter**. Consumers who want lower-level access can import the builders, hand-build `params`, and call `docClient.send(...)` directly. The Adapter composes them with the hooks, the table name, and the options.

### 4.2 Constructor

```ts
class Adapter<TItem, TKey = Partial<TItem>> {
  constructor(options: AdapterOptions<TItem, TKey>);
}

interface AdapterOptions<TItem, TKey> {
  client: DynamoDBDocumentClient;
  table: string;
  keyFields: (keyof TItem & string)[];
  projectionFieldMap?: Record<string, string>;
  searchable?: Record<string, 1 | true>;
  searchablePrefix?: string;      // default '-search-'
  indirectIndices?: Record<string, 1 | true>;
  hooks?: Partial<AdapterHooks<TItem>>;
}
```

Changes from v2:

- **Dropped** from the constructor: `specialTypes`, `converter`, `converterOptions`, the DocumentClient sniff. All made redundant by one-format + lib-dynamodb.
- **`hooks`** groups the user hooks into one option. Individual hooks are still override-able by subclassing (or by passing the object). This reads better in a TypeScript-first signature and makes it obvious which methods are extension points.
- **`keyFields`** is the canonical name (matches v2); the v2 codebase also has `restrictKey` — now a private helper since it's only used for `prepareKey`.

### 4.3 CRUD surface

```ts
class Adapter<TItem, TKey> {
  // Reads
  getByKey(key: TKey, fields?: Path<TItem>[], options?: GetOptions): Promise<TItem | undefined>;
  getByKeys(keys: TKey[], fields?: Path<TItem>[], options?: GetOptions): Promise<TItem[]>;
  getAll(options?: ListOptions<TItem>, example?: Partial<TItem>, index?: string): Promise<PaginatedResult<TItem>>;
  getAllByParams(params: QueryOrScanInput, options?: ListOptions<TItem>): Promise<PaginatedResult<TItem>>;

  // Writes — single
  post(item: TItem): Promise<void>;                            // create-only (checkExistence)
  put(item: TItem, options?: PutOptions): Promise<void>;       // create-or-replace
  patch(key: TKey, patch: Patch<TItem>, options?: PatchOptions): Promise<void>;
  delete(key: TKey, options?: DeleteOptions): Promise<void>;
  clone(key: TKey, mapFn?: (item: TItem) => TItem, options?: CloneOptions): Promise<TItem | undefined>;
  move(key: TKey, mapFn?: (item: TItem) => TItem, options?: MoveOptions): Promise<TItem | undefined>;

  // Writes — mass
  putAll(items: TItem[], options?: MassOptions): Promise<{processed: number}>;
  deleteByKeys(keys: TKey[], options?: MassOptions): Promise<{processed: number}>;
  deleteAllByParams(params: QueryOrScanInput, options?: MassOptions): Promise<{processed: number}>;
  cloneByKeys(keys: TKey[], mapFn?: (item: TItem) => TItem, options?: CloneOptions & MassOptions): Promise<{processed: number}>;
  cloneAllByParams(params: QueryOrScanInput, mapFn?, options?): Promise<{processed: number}>;
  moveByKeys(keys, mapFn?, options?): Promise<{processed: number}>;
  moveAllByParams(params, mapFn?, options?): Promise<{processed: number}>;

  // Batch builders (for use with applyBatch / applyTransaction)
  makeGet(key: TKey, fields?, params?): Promise<BatchGetDescriptor<TItem>>;
  makeCheck(key: TKey, params?): Promise<BatchCheckDescriptor>;
  makePost(item: TItem): Promise<BatchPutDescriptor>;
  makePut(item: TItem, options?: PutOptions): Promise<BatchPutDescriptor>;
  makePatch(key: TKey, patch: Patch<TItem>, options?: PatchOptions): Promise<BatchPatchDescriptor>;
  makeDelete(key: TKey, options?: DeleteOptions): Promise<BatchDeleteDescriptor>;
}
```

Changes from v2:

- **Options bags.** Everywhere the v2 API had a positional `force?`, `returnRaw?`, `ignoreIndirection?`, `params?` chain, v3 has a single `options` object. The TypeScript type enumerates the supported fields; extension is additive; call sites read better.
- **`returnRaw` dropped.** Replaced by `options.reviveItems: false`, which suppresses the `revive()` call and returns `Raw<TItem>`. The tri-state is gone because the tri-state is gone from the data model (§3.1).
- **`generic*` methods dropped.** Replaced by `options.strategy: 'native' | 'sequential'` on the mass operations. Default `'native'`. The sequential variants still exist internally; the user surface has one name per operation.
- **`cloneByKey` / `moveByKey` dropped** as separate names. The single-item `clone` / `move` now take a key directly; `cloneByKey(key, ...)` and `clone({key1: ...})` collapse since v2's `clone` took a partial item and extracted the key internally — v3 makes the key the only argument for clarity. (The auto-upgrade via `checkConsistency` still works the same way.)
- **`getByKey` replaces v2's `get`.** v2 had both `get(item, fields, params)` and `getByKey(key, fields, params, returnRaw, ignoreIndirection)`; the v3 single-name takes a key. Consumers who pass full items adapt (one-line: `adapter.getByKey(pick(item, 'id'))`).

### 4.4 Hooks

```ts
interface AdapterHooks<TItem> {
  prepare?(item: TItem, isPatch?: boolean): TItem;
  prepareKey?(key: Partial<TItem>, index?: string): Partial<TItem>;
  prepareListInput?(example: Partial<TItem>, index?: string): Record<string, unknown>;
  updateInput?(input: Record<string, unknown>, op: {name: OpName; force?: boolean}): Record<string, unknown>;
  revive?(rawItem: TItem, fields?: string[]): TItem;
  validateItem?(item: TItem, isPatch?: boolean): Promise<void>;
  checkConsistency?(batch: BatchDescriptor): Promise<BatchDescriptor[] | null>;
}
```

Renames from v2: `prepareListParams` → `prepareListInput`; `updateParams` → `updateInput`.

Default implementations: identity for `prepare`/`prepareKey`/`prepareListInput`/`updateInput`; `subsetObject` for `revive`; `async () => {}` for `validateItem`; `async () => null` for `checkConsistency`.

Extension: consumers may pass hooks via the constructor `options.hooks` bag **or** subclass the Adapter and override methods. Both are supported; internally the Adapter prefers the `options.hooks` bag if present.

### 4.5 Transaction auto-upgrade

Unchanged behavior: every CRUD method builds its batch descriptor, calls `checkConsistency(descriptor)`, and if that returns `BatchDescriptor[]`, upgrades the single op to a `transactWriteItems` call covering the write + the consistency actions. The v3 limit of 100 actions gives auto-upgraded transactions a much larger ceiling (v2 was capped at 25).

Failure mode: if `checkConsistency` returns more actions than the ceiling minus 1, the Adapter throws a `TransactionLimitExceededError` with a body listing the action count. No silent splitting — consistency actions are, by definition, supposed to be atomic.

---

## 5. Expressions

All expression builders ship from `dynamodb-toolkit/expressions` and are **pure functions**. They accept a `params` object (cloned internally if they mutate) and return a new `params` with the relevant expression strings and attribute maps filled in. All of them handle name de-duplication, alias namespacing (`#upk0`, `:upv0`, `#sr0`, `:flt0`, `#pj0`, `#k0`), and reuse of pre-existing `ExpressionAttributeNames` / `ExpressionAttributeValues`.

### 5.1 Patch builder

```ts
interface PatchOptions {
  delete?: string[];           // paths to REMOVE
  separator?: string;          // path separator, default '.'
  arrayOps?: ArrayOp[];        // optional: append, prepend, setAtIndex, removeAtIndex
  conditions?: ConditionClause[];
}

function buildUpdate<TItem>(
  patch: Patch<TItem>,
  options?: PatchOptions,
  params?: UpdateCommandInput
): UpdateCommandInput;
```

Programmatic callers use the options bag. The wire (KoaAdapter body parser) recognizes `_delete` / `_separator` meta-keys and translates them into the options bag before invoking `buildUpdate`. Meta-prefix is configurable (see §7).

**Array operations** (new in v3, see §5.2) are expressed via `arrayOps`, not magic keys:

```js
buildUpdate(
  { name: 'Bespin' },
  {
    arrayOps: [
      { op: 'append', path: 'moons', values: ['A'] },
      { op: 'removeAtIndex', path: 'tags', index: 2 },
    ],
  }
);
```

**Dotted-path handling** stays as in v2: `'config.a'` becomes a nested `SET`; pure-digit segments are treated as array indices (e.g., `'items.3.qty'` → `items[3].qty`).

### 5.2 Array operations

DynamoDB's `UpdateExpression` natively supports four atomic array operations; all ship in v3:

| `op` | DDB expression | Notes |
|---|---|---|
| `append` | `SET path = list_append(if_not_exists(path, :empty), :values)` | Adds to tail. |
| `prepend` | `SET path = list_append(:values, if_not_exists(path, :empty))` | Adds to head. |
| `setAtIndex` | `SET path[i] = :value` | Absolute-index write. |
| `removeAtIndex` | `REMOVE path[i]` | Absolute-index delete. DDB leaves the slot empty (no shift). |

**Not shipped in v3 (deferred):**

- `splice` (remove-and-shift), `reorder` (swap indices), `insert-at-index` (shift-up). These cannot be expressed atomically in a single `UpdateExpression`; they would require read-modify-write (not concurrency-safe) or a `transactWriteItems` read + write pair with preconditions. Wait for a concrete use case and a consumer willing to accept the weaker atomicity or the heavier API.

### 5.3 Projection builder

`addProjection(params, fields, fieldMap, mergeExisting)` — unchanged in spirit. Handles de-duplication, dotted-path aliasing, and reuse of pre-existing `ExpressionAttributeNames`. Exported as a standalone function.

v3 refinement: the `fieldMap` parameter moves to the Adapter's `projectionFieldMap` option, so calls from within the Adapter pick it up automatically. Standalone callers still pass it explicitly.

### 5.4 Filter builder

`buildFilter(searchables, query, params)` — ships the substring, case-insensitive `contains(...)` over `searchable` mirror columns pattern from v2. Options gain:

```ts
interface FilterOptions {
  mode?: 'substring' | 'prefix' | 'exact' | 'tokenized';
  caseSensitive?: boolean;
}
```

Default `{mode: 'substring', caseSensitive: false}` preserves v2 behavior.

**Filter-by-example** ships as a separate helper: `buildFilterByExample(partial, params, options?)` builds an equality `FilterExpression` from a partial object. Used by the REST layer for §4.1 #9 of the survey.

### 5.5 Condition builder

New helper: `buildCondition(clauses, params)`. v2 inlined conditions via `updateParams`; v3 surfaces them as an explicit builder so `ConditionExpression` has first-class support alongside `UpdateExpression`, `FilterExpression`, and `ProjectionExpression`.

```ts
type ConditionClause =
  | { path: string; op: '=' | '<>' | '<' | '<=' | '>' | '>='; value: unknown }
  | { path: string; op: 'exists' | 'notExists' }
  | { path: string; op: 'beginsWith' | 'contains'; value: unknown }
  | { path: string; op: 'in'; values: unknown[] }
  | { op: 'and' | 'or'; clauses: ConditionClause[] }
  | { op: 'not'; clause: ConditionClause };
```

The `updateInput` hook remains the escape hatch for anything the builder doesn't cover.

---

## 6. Types

Hand-written `.d.ts` sidecars. The ambition is **deep**: typed paths, branded raw markers, discriminated-union descriptors. All cheap to iterate, zero runtime cost, serves as a precursor for a future `zod`-based validation recipe.

### 6.1 Core shapes

```ts
// paths.d.ts
type Path<T, Depth extends unknown[] = []> =
  Depth['length'] extends 5 ? string :                         // depth guard
  T extends readonly (infer U)[]
    ? `${number}` | `${number}.${Path<U, [...Depth, 1]>}`
    : T extends object
      ? { [K in keyof T & string]: `${K}` | `${K}.${Path<T[K], [...Depth, 1]>}` }[keyof T & string]
      : never;

// raw.d.ts
declare const rawBrand: unique symbol;
type Raw<T> = T & { readonly [rawBrand]: true };
declare function raw<T>(item: T): Raw<T>;
```

### 6.2 Patch and batch types

```ts
type Patch<T> = { [K in Path<T>]?: unknown }; // looser than TItem-keyed to accept partial updates with dotted paths

type BatchDescriptor<TItem = unknown> =
  | { action: 'get';    adapter: Adapter<TItem>; params: GetCommandInput }
  | { action: 'check';  params: GetCommandInput }
  | { action: 'put';    params: PutCommandInput }
  | { action: 'patch';  params: UpdateCommandInput }
  | { action: 'delete'; params: DeleteCommandInput };
```

### 6.3 Re-exports

Re-export `DynamoDBDocumentClient`, `NativeAttributeValue`, `NumberValue` type names (not values) from `@aws-sdk/lib-dynamodb` / `@aws-sdk/util-dynamodb` at the main entry so consumers don't import from two trees. `import type { DynamoDBDocumentClient } from 'dynamodb-toolkit'` works; the value `DynamoDBDocumentClient` still comes from `lib-dynamodb` at runtime.

### 6.4 Pragmatism

Deep types that start to obstruct usability (recursive `Path<T>` hitting depth limits on large schemas; `PatchResult<T, P>` inference melting the compiler) can fall back to `string` at the boundary. The sidecars are hand-written — ergonomics at call sites beats type-theoretic purity.

---

## 7. REST layer

### 7.1 Architecture

v3 splits the REST layer into three pieces:

1. **Framework-agnostic core** (`dynamodb-toolkit/rest-core`): pure helpers — parsers, builders, policies. No `koa`, `express`, `hono`, or `http` in its imports. Ships **inside the main toolkit package**.
2. **`node:http` handler** (`dynamodb-toolkit/handler`): a thin `(req, res) =>` request handler that wires `rest-core` helpers to standard Node `IncomingMessage` / `ServerResponse`. Zero framework deps — it's the handler equivalent of `tape6-server.js`. Ships inside the main toolkit package because `node:http` types are runtime-standard and no npm dep is required.
3. **Koa wrapper** — a **separate package** (`@uhop/dynamodb-toolkit-koa` or similar) that maps Koa `ctx` to `rest-core` inputs and back. `koa`, `koa-router`, `koa-body` are its own `peerDependencies`, not the main toolkit's. Express/Hono wrappers follow the same pattern as separate packages.

**Key consequence:** the main `dynamodb-toolkit` package has **no Koa dependency at all** — not even in `devDependencies`. The test harness (§9) uses the `node:http` handler directly, like `tape-six`'s own server. The Koa adapter package has its own test suite that imports `dynamodb-toolkit/rest-core` and verifies the Koa wiring against `koa` (which only that package carries).

### 7.2 Helper inventory

Every functional requirement from `v3-survey.md` §4.1 maps to one or more helpers in `rest-core`:

| Requirement | Helper(s) |
|---|---|
| Parse field subsetting | `parseFields(input)` → `{include, exclude}` |
| Parse sorting | `parseSort(input)` → `{field, direction, chain}` |
| Parse filter | `parseFilter(input)` → `{mode, query}` |
| Parse patch body | `parsePatch(body, {metaPrefix})` → `{patch, options}` |
| Parse key list | `parseNames(input)` → `string[]` |
| Parse pagination | `parsePaging(input, {defaultLimit, maxLimit})` → `{offset, limit}` |
| Build pagination envelope | `buildEnvelope(result, {keys})` → configurable key shape |
| Build error body | `buildErrorBody(err, {includeDebug, errorId})` → configurable envelope |
| Mass-op-by-criterion | `findAndPatch`, `findAndDelete`, `findOneAndPatch` |
| Cache hooks | `etag(item)`, `lastModified(item)`, `vary(ctx)` |

All helpers are pure. The Koa wrapper wires them to routes; consumers can call them from custom routes in any framework.

### 7.3 Default routing pack

`koaAdapter({adapter, policy, routes: 'standard'})` mounts:

| Method | URI | Maps to |
|---|---|---|
| `GET` | `/` | `getAll` + pagination envelope |
| `GET` | `/:key` | `getByKey`; `404` on miss |
| `GET` | `/-by-names?names=…` | `getByKeys`; plain array, missing silently dropped |
| `POST` | `/` | `post`; `204` |
| `PUT` | `/:key` | `put`; `204` |
| `PATCH` | `/:key` | `patch`; `204` |
| `DELETE` | `/:key` | `delete`; `204` |
| `DELETE` | `/` | `deleteAllByParams` + filter; `{processed: N}` |
| `PUT` | `/-load` | bulk `putAll`; `{processed: N}` |
| `PUT` | `/-clone/` or `/-clone/?filter=…` | `cloneAllByParams`; `{processed: N}` |
| `PUT` | `/:key/-clone` | single-item `clone`; `204` or `404` |
| `PUT` | `/:key/-move` | single-item `move`; `204` or `404` |
| `PUT` | `/-clone-by-names/?names=…` | `cloneByKeys`; `{processed: N}` |
| `PUT` | `/-move-by-names/?names=…` | `moveByKeys`; `{processed: N}` |
| `DELETE` | `/-by-names?names=…` | `deleteByKeys`; `{processed: N}` |

Method-prefix character `-` is configurable via `policy.methodPrefix`.

### 7.4 Policy knobs

```ts
interface RestPolicy {
  metaPrefix: string;              // default '_' (wire-side meta keys)
  dbPrefix: string;                // default '-' (DB-internal fields; informational)
  methodPrefix: string;            // default '-'
  envelope: {
    items?: string;                // default 'data'
    total?: string;                // default 'total'
    offset?: string;               // default 'offset'
    limit?: string;                // default 'limit'
  };
  statusCodes: {
    miss?: number;                 // default 404
    validation?: number;           // default 422
    consistency?: number;          // default 409
    throttle?: number;             // default 429
    transient?: number;            // default 503
    internal?: number;             // default 500
  };
  errorBody: (err: unknown, ctx: RestErrorContext) => unknown;
  needTotal?: boolean;             // designer-time; default true
  defaultLimit?: number;           // default 10
  maxLimit?: number;               // default 100
}
```

**`needTotal` is a designer-time option**, set per-route (or globally on the handler/adapter), never a client-facing query param. Rationale: whether an endpoint needs `total` is stable at design time. An admin dashboard needs it; an infinite-scroll feed doesn't. The toolkit doesn't ship a `?total=0` default; a designer may wire one up if their API permits.

### 7.5 Error mapping

The v2 server's catch-all `500` is replaced by a mapping that runs before the final fallback:

```
ConditionalCheckFailedException       → statusCodes.consistency   (409)
ValidationException / ValidationError → statusCodes.validation    (422)
ProvisionedThroughputExceededException → statusCodes.throttle     (429)
RequestLimitExceeded                  → statusCodes.throttle      (429)
TransactionCanceledException          → statusCodes.consistency   (409)
TransactionConflictException          → statusCodes.consistency   (409)
(network / 5xx SDK errors)            → statusCodes.transient     (503)
(anything else)                       → statusCodes.internal      (500)
```

The error envelope is `{code, message}` by default (matching the current v2 server), extensible via `policy.errorBody`.

### 7.6 Patch on the wire

The wire format stays `{field: value, _delete: [...], _separator: '.'}` with the meta-prefix configurable. `parsePatch` extracts the meta keys into the `PatchOptions` bag and calls `buildUpdate(patch, options)`. The programmatic `buildUpdate` never sees magic keys.

Backwards compatibility with the v2 wire format (which used `__delete` / `__separator`) is **not** provided: v3 is green-field. The default prefix can be set to `__` to accept the v2 shape, but the default is article-style `_`.

---

## 8. Packaging

### 8.1 ESM-only

`"type": "module"`; native `import` / `export`. No dual-publish.

### 8.2 Layout

```
src/
  index.js, index.d.ts           # Adapter re-export, Raw, core types
  adapter/
    adapter.js, adapter.d.ts     # class Adapter
    hooks.js, hooks.d.ts
    transaction-upgrade.js, .d.ts
  expressions/
    index.js, index.d.ts
    update.js, update.d.ts       # buildUpdate + array ops
    projection.js, projection.d.ts
    filter.js, filter.d.ts
    condition.js, condition.d.ts
    clean-params.js, clean-params.d.ts
    clone-params.js, clone-params.d.ts
  batch/
    index.js, index.d.ts
    apply-batch.js
    apply-transaction.js
    get-batch.js
    get-transaction.js
    backoff.js
  mass/
    index.js, index.d.ts
    write-list.js, delete-list.js, copy-list.js, move-list.js, read-list.js
    paginate-list.js              # offset/limit with filter
    iterate-list.js               # async iterator
    read-ordered-list-by-keys.js  # preserves caller order
  paths/
    index.js, index.d.ts
    get-path.js, set-path.js, delete-path.js, apply-patch.js
    normalize-fields.js, subset-object.js
  rest-core/
    index.js, index.d.ts
    parsers/*.js
    builders/*.js
    policy.js, policy.d.ts
  handler/
    index.js, index.d.ts
    handler.js, handler.d.ts      # (req, res) => handler wiring rest-core to node:http
    routes-standard.js
  sleep.js, sleep.d.ts            # bare, one-off
  seq.js, seq.d.ts
  random.js, random.d.ts
```

Folders where they earn their keep; bare files for one-offs (§2 of `src-functional-folder-layout`). No `index.js` re-export around a single file.

### 8.3 `package.json` `exports` map

```json
{
  "name": "dynamodb-toolkit",
  "type": "module",
  "exports": {
    ".":             { "types": "./src/index.d.ts",            "default": "./src/index.js" },
    "./expressions": { "types": "./src/expressions/index.d.ts", "default": "./src/expressions/index.js" },
    "./batch":       { "types": "./src/batch/index.d.ts",       "default": "./src/batch/index.js" },
    "./mass":        { "types": "./src/mass/index.d.ts",        "default": "./src/mass/index.js" },
    "./paths":       { "types": "./src/paths/index.d.ts",       "default": "./src/paths/index.js" },
    "./rest-core":   { "types": "./src/rest-core/index.d.ts",   "default": "./src/rest-core/index.js" },
    "./handler":     { "types": "./src/handler/index.d.ts",     "default": "./src/handler/index.js" }
  },
  "files": ["src"],
  "peerDependencies": {
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/lib-dynamodb":    "^3.0.0"
  }
}
```

**No `dependencies`.** Runtime is zero-dep; peers supply the SDK. No Koa/Express/Hono anywhere — framework adapters are separate packages with their own peer deps. The `./handler` sub-export uses only `node:http` types (standard runtime, not an npm dep).

### 8.4 Runtime targets

The toolkit follows the project-wide runtime matrix Eugene applies across all repos: **every non-EOL Node release (LTS or current) plus latest Bun and latest Deno**. No consumer has reported friction with this policy in other projects, so it stays the rule here.

**Supported runtimes (2026-04-15):** every non-EOL Node (20, 22, 24, 25), latest Bun, latest Deno. `engines.node` reads `">=20"` and is updated when the floor moves.

**CI matrix for this project:** `ubuntu-latest`, **latest Node only**. Rationale: pure JS, no native code, no OS-sensitive paths — there is no reason to extend to multiple Node versions or OS runners. DynamoDB Local via Docker adds a Docker requirement but not an OS matrix. See [[js-runtime-matrix]] for the cross-project CI policy and per-project decision guidelines.

**Rules for production code under `src/`:**

- ESM only. No CommonJS interop code paths.
- No runtime `node:*` imports (`node:http`, `node:crypto`, `node:fs`, etc.) in `src/`. All three runtimes support the `node:` protocol, but avoiding it keeps the surface portable and honest: the toolkit's production code should need only JavaScript-standard globals.
- Use `globalThis.crypto` (Web Crypto) for any cryptographic needs, not `node:crypto`. Standard in all matrix entries.
- Prefer `Uint8Array` over `Buffer` in interfaces; `Buffer` is a `Uint8Array` subclass in Node, so values round-trip fine, but the type surface stays runtime-neutral.
- Prefer globals `fetch`, `URL`, `URLSearchParams`, `crypto`, `TextEncoder`, `TextDecoder`, `structuredClone`, `setTimeout`, `queueMicrotask`, etc. (all three runtimes emulate).
- Lambda runtimes Node 20/22 covered by the Node floor; Node 24 ships on Lambda when AWS updates.
- The SDK peer deps (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`) are maintained to work on Node, Bun, and Deno, so they add no portability risk.

**Test suite** targets latest Node only. Uses `node:test`'s `mock` API, `node:http`, built-in `fetch`. Rationale: Node-specific test infra lets us stay near-zero dev-dep; Bun/Deno test matrices are deferred until a runtime-specific bug is reported. Production code's cross-runtime claim is verifiable by inspection (no `node:*` imports) rather than by a per-runtime test matrix.

---

## 9. Testing

The current test setup — create a real AWS DynamoDB table by hand, run Postman against a locally-started Koa server, delete the table by hand — is replaced end-to-end.

### 9.1 Test runner

**`tape-six`**. Sibling-project parity ([[projects/stream-json]], [[projects/stream-chain]], etc.); written by Eugene, so using it here is also a battle-test for tape-six itself and a source of bug/feature feedback. One `devDependencies` entry; accepted.

### 9.2 Zero other dev dependencies

Everything else comes from Node's standard library:

- **Mocking**: `import { mock } from 'node:test'`. `mock.method(docClient, 'send', impl)` intercepts SDK calls. A small in-repo helper (`tests/helpers/matchCommand.js`) reads `command.constructor.name` and `command.input` for pattern matching. `mock.restoreAll()` in tape-six `t.after()` hooks.
- **HTTP testing**: no `supertest`, no Koa. The test server is a standalone `node:http` handler file (like `tape6-server.js` — ~200 lines, no deps) that imports `dynamodb-toolkit/handler` and wires it to `node:http.createServer`. A small `withServer(handler, fn)` helper manages the lifecycle:

  ```js
  // tests/helpers/withServer.js
  import { createServer } from 'node:http';
  import { once } from 'node:events';

  export async function withServer(handler, fn) {
    const server = createServer(handler);
    server.listen(0);
    await once(server, 'listening');
    const {port} = server.address();
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
      await once(server, 'close');
    }
  }
  ```

  The test handler imports `rest-core` parsers + builders + the `node:http` handler, mounts the standard REST routes against a test Adapter, and is exercised via built-in `fetch`. This tests the real REST surface without any framework adapter — if it works on `node:http`, it works on Koa/Express/Hono too.

- **DynamoDB Local lifecycle**: spawned via `node:child_process` (no `testcontainers` dep). A helper checks whether `docker` is available and whether DynamoDB Local responds on a chosen port; if neither, the end-to-end layer skips with a clear message.

Result: `devDependencies` contains only `tape-six` and the SDK peer deps pinned for local development (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`). No Koa. No supertest. No aws-sdk-client-mock.

### 9.3 Layers

**Unit layer** — pure functions, no SDK, no storage:

- Expression builders: `buildUpdate`, `buildProjection`, `buildFilter`, `buildCondition`, `cleanParams`, `cloneParams`.
- Path utilities: `getPath`, `setPath`, `deletePath`, `applyPatch`, `subsetObject`, `normalizeFields`.
- Patch wire-parser: `parsePatch` (`_delete` / `_separator` translation).
- REST-core parsers: `parseFields`, `parseSort`, `parseFilter`, `parseNames`, `parsePaging`.
- Error mapping.

**Integration layer** — Adapter + mass ops with `mock.method` on `DynamoDBDocumentClient.prototype.send`:

- Intercept commands by class name (`PutCommand`, `UpdateCommand`, `BatchWriteCommand`, `TransactWriteCommand`, …) and assert on their `input` shape.
- Covers transaction auto-upgrade (assert the call became `TransactWriteCommand`), `UnprocessedItems` retry loops (return partial unprocessed on call 1, empty on call 2), indirect-index second-hop (assert a follow-up `BatchGetCommand` against the base table), `needTotal` plumb-through (assert presence/absence of a `Select: 'COUNT'` scan).
- Doesn't verify DynamoDB's actual semantics — that's the end-to-end layer's job.

**End-to-end layer** — DynamoDB Local:

- Uses the official `amazon/dynamodb-local` Docker image (free, ephemeral, no AWS account needed).
- Test harness spins the container up as a fixture, creates a table per suite with a random name suffix, loads the Star Wars planets fixture (`tests/data.json.gz` → `fixtures/planets.js`), runs the test suite, deletes the table, tears the container down.
- REST coverage: the test server (pure `node:http` handler, see §9.2) exercises the 40-request Postman-era scenarios as tape-six tests against the real DynamoDB Local using built-in `fetch`. No Koa involved.

**Opt-in real-AWS mode** — documented, not default:

- `AWS_REAL=1 TEST_TABLE_PREFIX=ci- npm run test:e2e` runs the same end-to-end suite against real DynamoDB with the configured profile, creating and deleting a table under a known prefix. Used for CI sanity checks before releases; never in the default `npm test`.

### 9.4 Fixtures

- `fixtures/planets.js` — the Star Wars planets dataset, re-exported as plain JS (dropping the `.json.gz` form; the 61 items are small enough to keep inline or in a `.json` sibling).
- `fixtures/table-schema.js` — the `CreateTable` input (key schema, GSIs matching `indirectIndices` tests).

### 9.5 Test-harness lifecycle

```
before suite:  spawn docker run amazon/dynamodb-local -p <random>  (or skip with message)
               CreateTable (random-suffixed name)
               putAll(planets)
during suite:  tests hit Adapter / KoaAdapter (mock or real DynamoDB Local)
after suite:   DeleteTable
               docker stop
               mock.restoreAll()
```

Scripts under `tests/` drive this; developers run `npm test` and get the full loop. CI runs the same script.

### 9.6 No test table to manage

The documented path is always DynamoDB Local. The developer does not need an AWS account for default tests. The "real AWS" mode is opt-in and covers its own setup / teardown.

---

## 10. Documentation and cutover

### 10.1 AI-facing docs in-repo

- `AGENTS.md` — canonical project rules.
- `CLAUDE.md`, `.github/COPILOT-INSTRUCTIONS.md`, `.windsurfrules`, `.cursorrules`, `.clinerules` — pointers / byte-identical copies.
- `llms.txt` / `llms-full.txt` — quick and detailed references, regenerated by the `ai-docs-update` skill.
- `dev-docs/v3-survey.md`, `dev-docs/v3-design.md` (this file) — design artifacts.

### 10.2 User-facing docs in the wiki (git submodule)

Cutover plan (confirmed): **tag + delete**.

1. Write v3 wiki pages on a scratch branch of the wiki repo.
2. At cutover: `git tag -a v2.3-docs -m "v2.x documentation snapshot"` from `main` HEAD; push the tag.
3. Replace wiki `main`: delete v2 pages, commit v3 pages, `Home.md` gets a one-line pointer to the tag (`git checkout v2.3-docs` recipe included).
4. Bump the wiki submodule SHA in the main repo in the same PR that ships v3.
5. `README.md` / `AGENTS.md` gain a short pointer so AI agents know where to look for v2 docs.

No parallel `docs/` tree in the main repo. Wiki is the single user-facing home.

### 10.3 Migration guide

Ship `wiki/Migration:-v2-to-v3.md` covering:

- Client construction: v2 `makeClient` → v3 `DynamoDBDocumentClient.from(new DynamoDBClient({region}), {marshallOptions: {removeUndefinedValues: true}})`.
- Adapter constructor shape: old positional → new options bag.
- Dropped configs: `specialTypes` (Sets are native), `converter` / `converterOptions` (lib-dynamodb does it).
- Dropped methods: `fromDynamoRaw`, `toDynamoRaw`, `markAsRaw` (use `raw()` helper instead).
- Hook renames: `prepareListParams` → `prepareListInput`, `updateParams` → `updateInput`.
- Options-bag migration: `force?` / `returnRaw?` / `ignoreIndirection?` positional args → `{force, reviveItems, ignoreIndirection}` object.
- Patch wire: `__delete` / `__separator` → `_delete` / `_separator` (configurable).
- Transaction limit raised 25 → 100; user-built transaction callers can increase chunk size accordingly.
- REST error envelope: `500` catch-all replaced by mapped `409` / `422` / `429` / `503` / `500`.

### 10.4 SDK v2 → SDK v3 cheat sheet

Ship a second wiki page with the AWS-level changes most consumers hit: module imports, client construction, Commands vs. methods, `.promise()` gone, paginators, credential providers. This supplements AWS's own guide with the toolkit's recommended shape.

---

## 11. Observability

Out of scope for v3's initial release. The toolkit's seams are documented for consumers who want to add their own instrumentation:

- The `DynamoDBDocumentClient` has its own middleware stack; consumers register `build` / `serialize` / `finalizeRequest` / `deserialize` middleware directly on their client before handing it to the Adapter.
- The `updateInput` hook sees every Command's `Input` object before dispatch.
- An optional `adapter.options.logger?: (event: AdapterEvent) => void` surface is reserved as a future extension point, not shipped in v3.

---

## 12. Follow-ups (explicitly deferred)

The design doc closes these out as "not in v3 unless a concrete consumer asks":

1. `_array` splice / reorder / insert-at-index — requires read-modify-write or transactWrite-with-preconditions.
2. Tokenized / prefix / fuzzy search — current substring mode covers the Postman contract; richer search modes land when asked.
3. Express and Hono wrappers — ship as follow-up packages sharing `rest-core`.
4. `zod` integration — stays a documentation recipe unless validation pressure grows.
5. `makeClient` / credential helpers — dropped; `@aws-sdk/credential-providers` is the canonical answer.
6. `PUT`-as-`GET` long-URI escape hatch — document as a recipe, no helper.
7. API versioning helpers — out of scope; consumer-side routing.
8. CloudWatch / OTel exporters — consumer concern.

---

## 13. Open items for implementation

Items the design doc leaves to the implementer's judgment, flagged here for visibility:

- **Exact `ListOptions` shape.** `{offset, limit, descending, consistent, fields, filter, needTotal, reviveItems, strategy}` is the starting point; fields may be added during implementation.
- **Retry defaults.** `backoff` uses exponential + full jitter in v2 (base 50ms, cap 2s, 10 attempts). v3 keeps the shape; constants may be tuned based on DynamoDB Local behavior.
- **`KeyConditionExpression` builder.** Not called out explicitly as a named helper in this doc — implementation may surface it as `buildKey` inside `expressions/`, or leave it in the Adapter internals. Decide during coding.
- **`IndexName` → `keyFields` mapping.** When an index is used, the Adapter must know the index's key schema for `indirectIndices` behavior. v2 handles this implicitly; v3 should make it explicit in `AdapterOptions.indices?: Record<string, string[]>`.
- **Error classes.** Whether to throw `TransactionLimitExceededError`, `IndirectionUnresolvedError`, etc., as named classes (better for `instanceof` filtering) or plain `Error` with a `.code`. Lean named-class; finalize during coding.

---

## 14. Summary — what changes, what stays

**Stays:** every capability in §2 (15 invariants). The Adapter-centric mental model. Schemaless. Zero runtime dependencies.

**Changes:**

- One data format (plain JS via DocumentClient), not three.
- One `Raw<T>` brand, not `Raw` + `DbRaw`.
- Options bags, not positional-args-with-defaults.
- Strategy option on mass ops, not `generic*` sibling functions.
- Patch builder takes options explicitly; magic keys live only on the wire.
- Hooks renamed to `*Input` terminology.
- REST layer split into framework-agnostic core + thin Koa wrapper.
- First-class condition expressions, atomic array patch ops, filter-by-example.
- Tests: tape-six + DynamoDB Local + `aws-sdk-client-mock`, not Postman + manual inspection.
- ESM-only; `.js` + hand-written `.d.ts`; `src/` with functional subfolders; peer-deps on narrow SDK packages.
- Wiki retired via git tag; v3 pages replace on `main`.

**Dropped:**

- v2's three-format data model.
- `specialTypes`, `converter`, `converterOptions`.
- `makeClient`, `createClient`, `getProfileName`.
- `generic*` sibling methods (folded into strategy option).
- `returnRaw` tri-state (folded into `reviveItems` bool).
- Dual CommonJS publish.
- Custom sniffing of `DocumentClient`.
- Manual Postman + table-lifecycle workflow.

---

*End of design doc. Implementation starts after sign-off.*
