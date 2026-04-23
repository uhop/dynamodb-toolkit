# Marshalling registry — design sketch

> **Status.** Deferred from 3.7.0. Stage 1 (wire the car-rental example through the existing per-field `marshall*` / `unmarshall*` helpers) lands in 3.7.0; the registry proper is the Stage 2 move that this doc will drive.
>
> **Preference (Eugene).** Automatic application of marshalling / unmarshalling — not a "call this helper yourself in your prepare/revive hook" pattern. The registry should be declared on the Adapter; the built-in prepare/revive steps apply it so user hooks don't touch marshalling unless they want to.

## Context

The toolkit already ships per-field marshaller pairs under `dynamodb-toolkit/marshalling`:

- `dateISO` — `Date` ⇄ ISO-8601 string
- `dateEpoch` — `Date` ⇄ epoch milliseconds (number)
- `url` — `URL` ⇄ string
- `map(valueMarshaller?)` — `Map<K, V>` ⇄ DynamoDB map, optional value transform

Typed as `Marshaller<TRuntime, TStored>` pairs. Today users apply them inside their own `prepare` / `revive` hooks:

```js
hooks: {
  prepare: (item) => ({...item, createdAt: marshallDateISO(item.createdAt)}),
  revive:  (item) => ({...item, createdAt: unmarshallDateISO(item.createdAt)})
}
```

Works, but:

- Every declaration that marshalls a field copies the same three-line pattern.
- Errors are silent — forget to reverse in `revive` and the runtime gets ISO strings instead of `Date`s.
- No single place the toolkit can see "these fields are marshalled" (so `verifyTable` / descriptor record can't capture it without user help).

## Current state (for grounding)

- `src/marshalling/date.js`, `src/marshalling/url.js`, `src/marshalling/map.js` — stateless transform pairs.
- `src/marshalling/index.js` — public subpath re-exports.
- `Marshaller<TRuntime, TStored>` type pair in `types/marshalling.d.ts`.
- `adapter.js` built-in prepare/revive steps already run before user hooks when `technicalPrefix` is set — they handle structural key formation, searchable mirrors, sparse markers. The registry would slot in alongside these.
- Descriptor record (`__adapter__`) writes the adapter's declared shape; marshalling declarations are a natural addition.

## Sketch (Eugene)

<!-- Eugene will fill in the intended shape here.
     Leaving a placeholder so the doc is the one reference point.

     Things worth deciding in the sketch:
     - Shape of the declaration on the Adapter (field-map? type-dispatch? per-record type?)
     - Built-in vs. custom marshallers and how they're named
     - Interaction with technicalPrefix / versionField / createdAtField carve-outs
     - How it plays with multi-type adapters (car vs. boat have different fields — does the registry need type scoping?)
     - Failure mode on bad data (throw? warn? pass through?)
-->

_(to be written)_

## Open questions (seed list — revise freely)

- **R1.** Field-map vs. type-dispatch. The feedback-doc F6 raised this — is the declaration `{_createdAt: 'dateISO', homepage: 'url'}` or does the toolkit inspect runtime types (`Date` instance → `dateISO` automatically)? Automatic-by-type is more magical but maybe closer to what "automatic application" means here.
- **R2.** Per-type scoping in multi-type adapters. Cars have `year`; boats have `motorHP`. If the registry is a flat field-map, every type has to agree on field names and semantics. Does the registry need `marshal: {car: {year: 'number'}, boat: {motorHP: 'number'}}` (scoped by `typeDiscriminator`), or do we declare across the union and let unknown fields pass through?
- **R3.** Ordering vs. user hooks. If the registry runs in the built-in prepare step, does a user hook see the marshalled or the unmarshalled form? My lean: user hooks see unmarshalled (registry is the last prepare step before write), and unmarshalled again on revive (registry is the first revive step after read). User hooks stay in user-space.
- **R4.** Descriptor record should capture the registry. `verifyTable` can then warn on drift ("table has field `createdAt` stored as number; declaration says `dateISO` which is a string").
- **R5.** Inline custom marshallers — `{weight: {marshall: x => …, unmarshall: x => …}}`. Named built-ins by string (`'dateISO'`), inline objects for custom. Keeps the common case short.
- **R6.** Does `Marshaller` need to grow a third arg (`fieldName`) so one marshaller can branch on which field it's wrapping? Probably not — stay pure.

## Cross-refs

- `dev-docs/car-rental-feedback.md` §F6 — origin of this thread.
- `dev-docs/ergonomics-review-3.6.0.md` §E3 — `stampCreatedAtISO()` builders, probably subsumed by the registry.
- `src/marshalling/` — existing helpers this builds on.
