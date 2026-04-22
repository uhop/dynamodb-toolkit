# dynamodb-toolkit 3.6.0 — ergonomics review

> **Scope:** post-3.6.0-publish review. Build a realistic hierarchical REST API (car rental: state ⇒ facility ⇒ vehicle; vehicles are cars OR boats) against the finished toolkit and judge whether the code feels natural.
>
> **Output:** this note, plus the runnable example at `examples/car-rental/`.

The exercise surfaced two real bugs and several ergonomic trip-wires. Bugs were fixed in-tree during the review; ergonomic issues are categorized below.

## Bugs fixed

### 1. `adapter.buildKey` omitted the partition-key condition on composite keys

**Symptom.** For a composite `keyFields` with `structuralKey`, `adapter.buildKey({state: 'TX'}, {kind: 'children'})` produced:

```js
{
  KeyConditionExpression: 'begins_with(#kc0, :kcv0)',
  ExpressionAttributeNames: {'#kc0': '_sk'},
  ExpressionAttributeValues: {':kcv0': 'TX|'}
}
```

DynamoDB rejected the resulting `Query` with `ValidationException: Query condition missed key schema element` because the partition key (`state`) is required in the `KeyConditionExpression`.

**Fix.** `buildKey` now emits both the pk equality and the sort-key condition, using the `pkName` / `pkValue` knobs the `buildKeyCondition` primitive already exposed:

```js
{
  KeyConditionExpression: '#kc0 = :kcv0 AND begins_with(#kc1, :kcv1)',
  ExpressionAttributeNames: {'#kc0': 'state', '#kc1': '_sk'},
  ExpressionAttributeValues: {':kcv0': 'TX', ':kcv1': 'TX|'}
}
```

Tests updated to match (`adapter.buildKey: composite kind=exact / kind=children / partial / number zero-padded / custom separator`).

### 2. `adapter.patch` without `expectedVersion` conditioned on `attribute_not_exists`

**Symptom.** With `versionField` declared, `adapter.patch(key, partial)` (no `expectedVersion`) built a `ConditionExpression` of `attribute_not_exists(<pk>)` — which fails on every existing record. Patches on real data raised `ConditionalCheckFailedException`.

Root cause: `makePatch` unconditionally called `_addVersionCondition(p, options?.expectedVersion)`. When `expectedVersion` was `undefined`, `_addVersionCondition` fell into its `observed === undefined` branch and emitted the `attribute_not_exists` guard (intended for first-write `put`, not patch).

**Fix.** `makePatch` only applies the version condition when `expectedVersion` is set; otherwise it falls through to the standard `attribute_exists(<pk>)` existence guard, matching patch's intended "update-if-exists" semantic. The version still ADDs +1 via the UpdateExpression regardless. Test updated (`patch: without expectedVersion still increments version, conditions on existence only`).

### 3. `getListByParams` ignored `options.fFilter` / `options.asOf` / `options.filter`

**Symptom.** Callers who hand-build query params (e.g., via `buildKey`) and pass them to `getListByParams(params, options)` found `options.fFilter` / `options.asOf` silently dropped. Only `getList(options, example, index)` honored them — because `_buildListParams` applied them before handoff. The sibling mass-op list methods (`deleteListByParams`, `cloneListByParams`, etc.) honored `asOf` but not `fFilter`, compounding the inconsistency.

**Fix.** Moved the filter / asOf application out of `_buildListParams` and into `getListByParams`. Both entry points now funnel through the same application point. `getList` remains a thin wrapper that builds the example-driven base params and delegates. No test breakage.

## Ergonomic issues (not blocking, surfaced as findings)

### E1. The `fFilter` clause shape trips up the single-value ops

The clause is `{field, op, values: [...]}` where `values` is always an array — even for single-value ops like `eq`, `lt`, `ge`. Users instinctively write `{field: 'kind', op: 'eq', value: 'car'}` (singular). The toolkit silently drops the clause (no value emitted) and returns too many rows.

Options:

- **A.** Document the shape loudly; require `values` for everything.
- **B.** Accept both `value` (single) and `values` (array); normalize internally.

Preference: **B** is user-facing sugar with trivial implementation cost. `value` → `[value]` at the entry point; the rest of the op-dispatch code keeps reading `values`.

### E2. The descriptor record leaks into full-table `Scan` results

When `descriptorKey` is set, `ensureTable` writes a reserved record at `{keyFields[0]: '__adapter__'}`. It doesn't appear in any `buildKey`-scoped Query (because the pk condition excludes it), but any `ScanCommand` sees it. `adapter.typeOf(item)` classifies it as a `'state'` (depth-1), the label of the first keyField.

In the walkthrough this showed up as `Dispatch counts: { car: 9, boat: 5, state: 1, facility: 0, other: 0 }` — that `state: 1` is the descriptor, not a state record.

Options:

- **A.** Have `verifyTable` / `readDescriptor` mark the descriptor record and the toolkit exclude it by default in scans via a managed `FilterExpression`. Opt-out for "I really want to see the descriptor."
- **B.** Mark it with `__adapter: true` and let user code filter manually. Document.

Preference: **A** — the descriptor is adapter-machinery, not user data. A hidden-by-default posture matches the `technicalPrefix` philosophy (adapter-managed fields hidden on revive). Concretely: when the adapter has `descriptorKey`, inject `NOT (<pk> = :descriptorKey)` into the FilterExpression of every list op unless `{includeDescriptor: true}` is set.

### E3. `asOf` requires a caller-set `_createdAt`; built-in prepare doesn't stamp

The 3.4.0 design is "toolkit owns the condition; caller's prepare owns the format." That's principled, but the onramp cost is a boilerplate `prepare` hook in every declaration that wants `asOf`:

```js
prepare: (item, isPatch) => {
  if (isPatch || item._createdAt) return item;
  return {...item, _createdAt: new Date().toISOString()};
};
```

Every declaration copies this. It's the only idiomatic format for ISO timestamps.

Options:

- **A.** Keep as-is. Bias: "format is caller's choice" (epoch vs ISO vs custom).
- **B.** Ship a canned `stampCreatedAtISO()` / `stampCreatedAtEpoch()` hook builder that callers can pass directly: `hooks: {prepare: stampCreatedAtISO()}`.
- **C.** Auto-stamp when `createdAtField` is declared + `prepare` hook absent. Breaks "user prepare owns format" — no.

Preference: **B** — small, additive, keeps the principle intact. Either `stampCreatedAtISO` or inline composition in user code.

### E4. `cloneAllUnder` / `moveAllUnder` separate style from their prefix-swap siblings

`rename(from, to, {mapFn})` and `cloneWithOverwrite(from, to, {mapFn})` use positional `from, to`. But the 3.5.0 cascade primitives split into `cloneAllUnder(from, to, opts)` (prefix-swap) + `cloneAllUnderBy(from, mapFn, opts)` (mapFn-driven) — two intentional methods per op, per the earlier design conversation.

This split is the right call on its own (per the "intentional programming" feedback that drove 3.5.0's shape), but it creates a subtle inconsistency across the family:

| Method                                   | Shape                                       |
| ---------------------------------------- | ------------------------------------------- |
| `rename(from, to, {mapFn?})`             | positional; mapFn composes after swapPrefix |
| `cloneWithOverwrite(from, to, {mapFn?})` | positional; mapFn composes after swapPrefix |
| `cloneAllUnder(from, to, {mapFn?})`      | positional; mapFn composes after swapPrefix |
| `cloneAllUnderBy(from, mapFn, opts)`     | **mapFn positional** — no prefix swap       |

The first three are identical in spirit — mapFn is the escape hatch, prefix-swap is the default. The fourth is genuinely different. The naming (`-Under` vs `-UnderBy`) distinguishes them, but a user coming from `rename` might expect a `renameBy` counterpart for symmetry — and that doesn't exist.

**Not a defect; noting for consistency.** When we add a `renameBy` or folding of the `-UnderBy` concept back to `rename` via an options variant, revisit.

### E5. No sugar for "scan a subtree"; `QueryCommand` is needed directly

For subtree reads, the natural shape is:

```js
const {Items} = await client.send(new QueryCommand({TableName: TABLE, ...adapter.buildKey({state: 'TX', facility: 'Dallas'}, {kind: 'children'})}));
```

Every call site takes that two-line shape. The ergonomic win would be an `adapter.queryChildren(partialKey, options)` or `adapter.listUnder(partialKey, options)` sugar that:

1. Builds the KeyConditionExpression via `buildKey(partialKey, {kind: 'children'})`.
2. Sends the Query.
3. Revives each result through the `revive` hook + applies `fields` projection.

Current `getListByParams` almost fits — it takes `params` + `options`, revives, paginates — but the caller still has to build the KeyConditionExpression themselves.

Options:

- **A.** Add `adapter.getListUnder(partialKey, options)` sugar.
- **B.** Let `getList(options, example, index)` interpret `example` as a partial key and auto-build the KCE — e.g., `adapter.getList({}, {state: 'TX', facility: 'Dallas'})` means "children of Dallas." This breaks the existing semantic of `example` (currently a search filter example, not a key prefix).
- **C.** Leave as-is, document the two-line shape.

Preference: **A**. Scope: a single method that wraps buildKey + getListByParams. No new option semantics.

### E6. Filter grammar — `kind` isn't a keyField, so type comes from `'string'` fallback

`filterable: {kind: ['eq', 'in']}` declares the op allowlist. But the toolkit determines the coercion type for filter values via `_typeOfField(name)`, which only looks at `keyFields` and `indices`. For arbitrary attributes like `kind` / `make` / `year`, it falls back to `'string'`.

That works for strings — but `filterable: {year: ['eq', 'ge', 'le', 'btw']}` against `year: 2024` (number in DB) would filter against `':ffv0' = '2024'` (string) and return zero matches. Users have to lie in the URL (`?f-year-eq=2024` still goes as string → no match).

Options:

- **A.** Extend `filterable` to accept `{ops, type?: 'string' | 'number' | 'binary'}`.
- **B.** Keep type inference from keyFields/indices, and require users to declare via indices if they want non-string coercion. This locks type info to schema shape.

Preference: **A**. Filter grammar is a surface contract; let users declare types there.

### E7. One shared Adapter vs. two-per-type for the car/boat wrinkle — typeOf dispatch was clean

The walkthrough uses one shared Adapter with `typeDiscriminator: {name: 'kind'}`. `adapter.typeOf(item)` returned `'car'` / `'boat'` / `'state'` / `'facility'` as expected. Branching on the result in the REST layer felt natural:

```js
const t = adapter.typeOf(item);
if (t === 'car') validateCar(item);
else if (t === 'boat') validateBoat(item);
```

The alternative (two Adapters with their own route packs) would have doubled setup and complicated subtree ops like "delete all vehicles under TX/Dallas" (needs to span both adapters → custom cascade code). typeOf dispatch is the right call.

**Design deferral validated**: the multi-Adapter shared-table dispatch noted as deferred in Q13 isn't needed for this use case. For single-Adapter multi-type, `typeOf` is sufficient.

## Summary

The exercise shipped:

- 3 real bugs fixed in-tree: `buildKey` missing pk condition, `patch` OC false-reject, `getListByParams` silently ignoring options.
- 5 ergonomic findings (E1–E7) captured; none are blocking, all are candidates for a follow-up "polish" minor.
- 1 runnable example (`examples/car-rental/`) that functions as integration test + docs-adjacent template.

### Findings ranked

1. **E1 — `values` vs `value`** in `fFilter` clauses. Low-effort win; small caller-facing sugar.
2. **E5 — `adapter.getListUnder`** sugar. Low-effort, high-frequency pattern.
3. **E2 — descriptor record visibility**. Moderate effort; touches list-op params. Cleaner default.
4. **E6 — `filterable` type declaration**. Moderate effort; touches schema + coercion.
5. **E3 — canned `stampCreatedAtISO` hook**. Low-effort, additive.
6. **E4 — `-Under` / `-UnderBy` family consistency**. No action now; revisit when adding `renameBy`.

### Not found

- No issues with cascade primitives (`deleteAllUnder` / `cloneAllUnder{,By}` / `moveAllUnder{,By}`).
- No issues with `versionField` (once patch OC fix landed).
- No issues with `ensureTable` / `verifyTable` / descriptor round-trip.
- No issues with marshalling helpers (`marshallDateISO`).
- No issues with `typeOf` dispatch — cars-vs-boats wrinkle handled cleanly.
