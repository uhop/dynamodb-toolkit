# Hierarchical use case

This is an important use case that should shape how the toolkit evolves.

## Setup

Imagine a national car rental company with rental facilities in many US states and many
cars per facility. The data is organized hierarchically: US state ⇒ facility (by name or
number) ⇒ individual car.

We store three object types in one DynamoDB table — state operations, rental facilities,
and cars — with these logical keys:

- state-op: `state`
- rental: `state`, `rental-name`
- car: `state`, `rental-name`, `car-vin`

All three keys identify their object uniquely (`car-vin` is a real VIN).

## Why structured keys — efficiency

Creative use of key expressions lets us side-step `FilterExpression`, which is
inefficient. `FilterExpression` is applied **after** DynamoDB has already read items from
disk on a Query or Scan: it shrinks the response but never speeds up the read, and it is
effectively linear in the items touched. `KeyConditionExpression`, by contrast, operates
on the sorted partition-key / sort-key index: DynamoDB seeks directly to the range and
streams only matching items. Whenever we can express a query in terms of keys instead of
filters, we get indexed, sorted, efficient access at DynamoDB's native price point. The
rest of this document is about how to structure keys so queries can live on the index.

## Structured keys

To turn hierarchical data into index-friendly keys, we create a technical field whose
contents are a structured composite of the logical keys. Assuming our field values cannot
contain `|` (we sanitize inputs for that), we use:

- state-op: `"state"`
- rental: `"state|rental-name"`
- car: `"state|rental-name|car-vin"`

DynamoDB reference for keys:
<https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.KeyConditionExpressions.html>

The `begins_with()` operator covers most of the hierarchical work. Assume we have a Buick
in "Dallas Rental" in Texas (TX). The following lookups are all efficient (index seeks):

- `"TX"` — the state-operations record for Texas.
- `"TX|Dallas Rental"` — the Dallas Rental facility record.
- `"TX|Dallas Rental|Buick"` — a specific car at Dallas Rental.
  - VIN in practice, "Buick" used here for readability.
- `"TX|Dallas Rental|"` — all cars at that facility (as a `begins_with` query).
- `"TX|"` — all rentals and cars in Texas.

The index is sorted, and DynamoDB can walk it backwards (`ScanIndexForward: false`), so
descending-order listing is free. A structural key does constrain arbitrary sorting on its
component fields — not every field order can be served efficiently. We should communicate
that constraint to the user, with a clear exception path when they request an impossible
sort, and document it.

A GSI whose key is `"state|rental-name"` and that projects only rental-facility records
lets us list all rentals in a state via one Query on the GSI. The projection can be any
subset of the original object; most often the GSI row just points back to the main table.

In v2 this pattern was implemented through hooks (`prepare` / `revive` / etc.).
`prepareKey()` was responsible for building the key expression — entirely in user code,
because the toolkit shipped no helpers for composite keys.

## URL structure

URL design should mirror the hierarchy. One option: `/:state/:rental-name/:car-vin`.

- Individual operations:
  - `/TX` — the Texas state-operations record.
  - `/TX/Dallas%20Rental` — the rental-facility record.
  - `/TX/Dallas%20Rental/Buick` — the specific car record.
    - VIN in practice.
- Mass operations (typically combined with `?fields=…`):
  - `/TX/--rentals` — list of all rentals in Texas, paginated.
  - `/TX/--cars` — list of all cars in Texas, paginated.
  - `/TX/Dallas%20Rental/--cars` — list of all cars at Dallas Rental.

Mass operations use meta-markers (`--rentals`, `--cars`) to indicate intent. The `--`
prefix keeps them distinct from real facility names and VINs, which we sanitize to
exclude the prefix. If `--rentals` happens to be a legal rental name in some application,
pick a different prefix, or use a different mechanism for meta-markers entirely.

Meta-marker URLs accept the same verbs as individual URLs:

- `GET /TX` — fetch the Texas operations record.
- `GET /TX/--rentals` — list rentals in Texas (with `?limit=…&offset=…`).
- `DELETE /TX` — delete the Texas operations record **and all dependent objects**.
- `DELETE /TX/--rentals` — delete all Texas rental facilities and their cars, keeping the
  Texas operations record.
- `DELETE /TX/--cars` — delete all cars in Texas, keeping facility records.

This shows that mutating verbs (DELETE, MOVE, CLONE) can auto-upgrade to mass operations
on non-leaf URLs: deleting a state cascades to its dependents; renaming a facility must
rename every car beneath it (typically via `move()`).

`clone()` is useful when we have a typical object with a standard set of dependents. At
the application level it lets callers clone a shape-similar object and then modify the
result. To avoid name clashes, `clone()` and `move()` both accept a `mapFn` that can
rewrite each processed object on the fly.

## On index / URL design

Index and URL design depend heavily on the application. User choices:

- Which object names are legal.
  - This determines what meta-markers are safe. In the example above, `--rentals` must
    not be a legal facility name, and `--cars` must not be a legal VIN (real VINs cannot
    start with `--`, so the constraint is automatic there).
- The hierarchy, which fixes the order of fields in the structural key and the URL.
  - Example for a facility that rents cars *and* boats, listed separately:
    `/:state/:rental-name/cars/:car-vin` and `/:state/:rental-name/boats/:boat-vin`.
  - Not only linear hierarchies but also tree hierarchies are possible.
- Which operations must be aware of children: deleting or renaming a parent may require
  cascading operations on its descendants to preserve invariants. Cloning/copying can be
  offered similarly, again backed by mass operations.

Everything — the hierarchy, what names are valid, which operations are supported, the
exact operation and meta-marker names, even query-parameter names (`?f=…` instead of or
alongside `?fields=…`) — should be up to the user. Industry conventions or culture (e.g.,
French or Spanish meta-markers instead of English) may drive these choices. Our job is to
make such building simple, robust, and efficient.

When operating on sets of objects, meta-markers in the URL identify the target set —
this keeps the API RESTful. We disambiguate the exact operation with an existing verb
plus query parameters: `PUT /TX?op=copy&name=FL` to `clone()` all Texas records as
Florida records. Alternatively, the operation can be encoded in the URL path itself
instead of a query parameter.

## Conclusions

This use case is important and must be supported. If anything in our code prevents it,
the code should be fixed. The technique pushes DynamoDB beyond a simple key/value store
and enables complex scenarios that are both efficient and inexpensive.

Wherever we can offer useful helpers, we should. The pattern belongs in the wiki, with
concrete guidance on:

- What is possible with structured keys.
- How to select and design structured keys and URLs that reflect them.
- How to design secondary indices (GSIs) and their keys.

The goal is a rich foundation built from simple, efficient pieces.

## General notes

This is why the adapter's `keyFields` is an array of strings, not a single string: it
drives the structured index. Never assume the array has exactly one element.

The same reasoning explains our built-in command names — `-by-names`, `-clone`,
`-clone-by-names` — chosen so they stay distinct from real object names in a user's
application. A user is of course free to adopt a different URL scheme entirely.

Alternative URL design (tree-style, path-segment meta-markers):

- `/:state` — state-operations record.
- `/:state/rentals` — list of rental facilities in that state.
- `/:state/rentals/:rental-name` — a specific facility.
- `/:state/rentals/:rental-name/cars` — cars at that facility.
- `/:state/rentals/:rental-name/cars/:car-vin` — a specific car.

The idea is the same as our most common design: URLs are pointers to two kinds of things:

- An individual record.
- A list of records at the same level of the hierarchy.

We then apply verbs to these pointers, operating on either a single record or a list.
GET is unchanged; mutating verbs (delete, move, clone) auto-upgrade to mass operations
on non-leaf URLs.

This design is also RESTful, needs no meta-marker prefixes, and requires no name
sanitization. The tradeoff is longer, wordier URLs.

**The toolkit must support any URL design and any key structure.**

At the object level (after `revive()`, before `prepare()` — which is where we build the
structured index field), the presence of certain key fields tells us the object type:

- A state record has `{state}`.
- A rental facility has `{state, rentalName}`.
- A car has `{state, rentalName, carVin}`.

By checking which key fields are present (and any type-specific markers), we can decide
what kind of object we are looking at. The included keys double as direct pointers to
parent records: `{state}` points to the state record; `{state, rentalName}` points to
the facility — so from a car or facility we already know its parents.

There are surely more ways to leverage DynamoDB for such needs — it all comes down to
keys and key expressions. Further research into smart uses of key/value stores is
warranted.

## Note on performance and consistency

Individual-object operations are generally fast, but mass operations can take a long
time. This concern sits outside this toolkit (we only deal with the database), but it
matters to applications using the toolkit.

In production I have seen cloning/moving operations take tens of seconds, sometimes
exceeding the AWS Lambda time limit (limits were lower back then).

It would be nice to provide a foundation for asynchronous mass operations: the user
kicks off the operation and is later notified of completion (via polling? a message?).
Something to think about.

A second mass-operation concern is atomicity. DynamoDB is NoSQL and does not support
full ACID; transactions cap at 100 operations, which may not be enough, and the shape of
batched transaction writes may not fit the mass operation we actually need.

We can treat mass operations as helpers composed of single operations, but in an
application with many concurrent operators that can lead to races — ACID exists for a
reason. Something to think about. At the very least we should warn users about this in
the documentation.

## Design principles (aligned so far)

A running record of design commitments that have emerged from discussion. These are not
questions — they are settled positions to build against.

### Audience

- **The toolkit's user is a programmer, not an end user.** The programmer uses our
  adapters (DB adapter + HTTP adapter) to build a REST API for *their* end users; the
  end user of that REST API is someone else entirely. Every design decision is measured
  against "does this make the programmer's life easier while letting them deliver a fast
  and flexible API to their end users?"
- **Programmers new to DynamoDB are the education target.** Readers coming from SQL are
  the ones who need the `KeyConditionExpression` vs. `FilterExpression` distinction,
  structured keys, sparse GSIs, idempotent-resume patterns. End users never see these
  concepts. The wiki is written for the programmer, not for their customers.
- **Flexibility wins over prescription.** When a design choice splits between "helpful
  default" and "rigid framework," we pick the helpful default plus an escape hatch. The
  programmer knows their domain; we do not.

### Query mechanics

- **`KeyConditionExpression` vs. `FilterExpression` is architectural.** The former is an
  index seek over a sorted range (O(log n) to locate, then a stream of matching items);
  the latter is a linear post-read filter that shrinks the response but not the read.
  Creative key design exists to push predicates into `KeyConditionExpression` wherever
  possible.
- **End users never see the distinction.** The programmer writing the adapter decides,
  per query parameter, whether it compiles to a KeyCondition or a Filter. The REST
  surface hides the choice.
- **`begins_with()` is the primary hierarchical query primitive.** The structural index
  field (join of `keyFields` with `|`) is what makes this possible.

### Structure

- **`keyFields` is always an array.** The structural index is the join of those fields.
  Never assume `keyFields.length === 1`.
- **URL ⇔ object-type is always unambiguous.** Given a URL path, the target object type
  is determined before any record is read. Both URL styles (`/TX/--cars` meta-marker and
  `/TX/cars/:vin` path-segment) satisfy this; any design that requires reading a record
  to know its type is out of scope.
- **URLs are pointers to either a single record or a list at one hierarchy level.** GET
  is unchanged across the two; mutating verbs (DELETE / MOVE / CLONE) auto-upgrade to
  mass operations on non-leaf URLs.
- **URL schema freedom.** The toolkit provides recipes, not a canonical schema. Meta-
  marker names, query-parameter names, and URL shape are programmer choices (may reflect
  industry, culture, or i18n).
- **Multi-type tables use discriminator + key-presence together.** The discriminator is
  optional; key-presence detection is always available. A discriminator field, when
  present, is often embedded in the structural index itself (`cars|…` vs. `boats|…`), so
  the type-detector recognises it from the key without a separate field read.

### Object lifecycle and hook roles

The canonical write/read cycle, with each hook's responsibility pinned down. Source of
truth: `src/adapter/hooks.d.ts` and `src/adapter/hooks.js` in v3.1.2.

**Write path** (`post`, `put`, `patch`, `putAll`, `clone*`, `move*`):

1. `validateItem(item, isPatch)` — async validator; throw to abort.
2. `prepare(item, isPatch)` — two-fold responsibility: (a) **technical-field
   construction** (structural index field built from `keyFields`, sparse-GSI technical
   fields when the type warrants them, search mirrors for case-insensitive substring
   filtering); (b) **type marshalling for values DynamoDB cannot round-trip natively**
   (JS `Map` → plain object or entries array; `Date` → ISO string or epoch; user-class
   instances → plain objects; anything else outside the SDK's auto-marshalling rules).
   Also renames and strips transient fields.
3. Command is built (`PutCommand` / `UpdateCommand` / `DeleteCommand` / etc.).
4. `updateInput(input, op)` — last-chance mutation of the Command's params before
   dispatch (custom `ReturnValues`, extra condition clauses, etc.).
5. `checkConsistency(batch)` — optional; when it returns an array, the adapter auto-
   upgrades the single Command into a `TransactWriteItems` bundling those descriptors.
   This is where cross-adapter invariant checks live (relevant to A6' later).
6. Dispatch.

**Read path — single-item ops** (`getByKey`, `patch`, `delete`, `clone`, `move`, …):

1. `prepareKey(key, index)` — shapes *only* the `Key` object for GetItem / UpdateItem /
   DeleteItem. Receives `index` (GSI name or `undefined`), so it can rewrite keys to
   match the GSI key schema. Does **not** build `params`.
2. Command dispatched.
3. `revive(rawItem, fields)` — symmetric to `prepare`: strip technical fields, rebuild
   marshalled types back into user shape (`Map` from entries; `Date` from ISO string;
   user-class instances via their constructor), apply projection, add calculated fields.

**Read path — list ops** (`getAll`):

1. `prepareListInput(example, index)` — produces `{IndexName, KeyConditionExpression,
   ExpressionAttributeNames, ExpressionAttributeValues, …}` to turn a Scan into a
   Query. **This is where `/TX/--rentals` → `begins_with(sk, "TX|")` actually gets
   emitted** — hierarchical list queries live here, not in `prepareKey`.
2. Query / Scan dispatched (after filter / projection / paging options are layered on).
3. `revive` runs per returned item.

**SDK-level auto-marshalling that `prepare` / `revive` do *not* need to handle.** AWS
SDK v3's `DynamoDBDocumentClient` (`@aws-sdk/lib-dynamodb`) round-trips these JS ↔
DynamoDB pairs automatically:

- `string`, `number`, `bigint`, `boolean`, `null` ↔ `S` / `N` / `BOOL` / `NULL`.
- `Uint8Array` / `Blob` ↔ `B`.
- Plain objects ↔ `M`; arrays ↔ `L`.
- `Set<string>` ↔ `SS`; `Set<number | bigint | NumberValue>` ↔ `NS`;
  `Set<Uint8Array | Blob | …>` ↔ `BS`. ([lib-dynamodb
  README](https://github.com/aws/aws-sdk-js-v3/tree/main/lib/lib-dynamodb).) Sets must
  be homogeneous; a mixed-type set throws at marshall time.

So `prepare` / `revive` own everything the SDK does *not* marshal: `Map`, `Date`,
user-class instances, circular references (unsupported at all), non-set JS collections.
Relevant `marshallOptions` that can shift the boundary:
`convertClassInstanceToMap: true` (coerce class instances to plain maps — loses
prototype, methods, non-enumerable state); `removeUndefinedValues: true` (strip
`undefined` instead of throwing); `wrapNumbers: true` (preserve precision beyond
`Number.MAX_SAFE_INTEGER` via `NumberValue`).

**Hook split the matters most for this use case:** `prepareKey` and `prepareListInput`
are **two separate hooks**. The former shapes keys for point ops; the latter produces
index-query params for list ops. Hierarchical `begins_with` queries live in
`prepareListInput`.

**Gap relevant to sparse-GSI-by-absence:** `prepare(item, isPatch)` does not receive a
type discriminator. For "write the sparse GSI technical field only on rentals," the
user's `prepare` detects the type itself from field presence. A small type-detector
helper (A8) would make this ergonomic without changing the hook signature — logged as
Q17.

### Secondary index design and selection (GSI + LSI)

- **GSI selection is adapter-declared, driven by URL or query parameter.** Two
  conventions, both valid:
  - **URL-driven:** a path segment or meta-marker selects the GSI
    (`/rentals/by-email?…`). Appropriate when the GSI serves a distinct access pattern
    the end user perceives as a separate view.
  - **Query-param-driven:** a sort or filter parameter implies the GSI
    (`?sort=-name` uses the `name`-sort GSI). Appropriate when the GSI is an
    optimisation detail that does not change the URL's semantic type.
- **The adapter knows which fields are indexed and when using an index is appropriate.**
  It can also decline to use one when the query is better served by the main table.
- **DynamoDB caps the number of GSIs per table.** Index design is up-front, careful, and
  not hidden by the toolkit.
- **Technical-field GSIs** apply the structural-key trick to GSIs: the indexed field is
  a computed / concatenated / formatted value built to enable a specific access pattern.
  E.g., a `status-date` field constructed as `"active|2026-04-20T…"` so a single Query
  on that GSI returns active items in chronological order — no filter, one index seek.
- **Sparse GSIs by absence.** DynamoDB excludes items that lack the indexed field from
  the GSI. This is an official, documented behaviour, not a quirk:
  *"A global secondary index only tracks data items where its key attributes actually
  exist."* — [DynamoDB Developer Guide, Global secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html).
  This lets one table host type-scoped indices cheaply: write the technical field only
  on records of the desired type, and the GSI naturally contains only those records.
  No type-discriminator partition needed. Commonly called a "sparse index" in AWS
  literature. Worth its own recipe in W2.
- **Sort-implies-index inference.** When the adapter schema declares which fields have
  sort-capable indices (GSI or LSI), `?sort=-name` can route to the appropriate one
  automatically. Falls back to main-table Query + in-memory sort when no index is
  available (with a documented cost characteristic). **Prefer LSI over GSI** when both
  would satisfy a partition-bounded query — LSIs share capacity, support strong
  consistency, and don't incur replication WCU.

### LSI-specific characteristics

- **Created at table creation only.** Unlike GSIs, LSIs cannot be added or removed
  after the table exists. The adapter's index schema must match the table's physical
  schema at creation; trying to declare an LSI post-hoc means recreating the table.
- **Max 5 LSIs per table** (vs. 20 GSIs). Budget accordingly.
- **Strongly consistent reads.** LSIs are the *only* way to get strongly consistent
  reads on an alternate sort order. `GetOptions.consistent: true` plus a Query against
  an LSI gives read-your-writes on the secondary sort. GSIs cannot do this — DynamoDB
  rejects `ConsistentRead` on GSI Query.
- **Shared partition key with base table.** An LSI is always scoped to a single
  partition — it provides alternate sort orders *within* a partition, not across them.
- **10 GB per-partition cap.** This includes base-table items plus every LSI entry
  that shares the partition key. Hitting the cap triggers
  `ItemCollectionSizeLimitExceededException`. Adding more LSIs to a partition that
  already has many items can reach the cap surprisingly fast. Design-time concern, not
  a runtime one; the toolkit can at most warn in documentation.
- **Shared throughput.** LSI writes consume WCU from the base-table's budget. No
  separate provisioning; no hot-index risk distinct from the base table's hot-partition
  risk.
- **Sparse by absence.** Same mechanism as sparse GSI: items without the LSI sort key
  are excluded. Same W2 recipe, different locality.

### When to pick which

Quick decision table:

| Concern | LSI | GSI |
| --- | --- | --- |
| Consistency | eventual or strong | eventual only |
| Capacity cost | shared with base | separate replication WCU |
| Partition-size cap | **10 GB incl. LSI entries** | unlimited (auto-spread) |
| Schema flexibility | creation-time only | add / remove anytime |
| Count limit | 5 | 20 |
| Access pattern | alternate sort within a partition | alternate sort / partition across table |

Rule of thumb: **LSI for alternate sort orders within bounded-size partitions that
may need strong consistency; GSI for cross-partition access patterns, or when the
partition could grow past 10 GB, or when you need schema flexibility.** For the
hierarchical car-rental example, this is a real tradeoff: partitioning on `state`
keeps the hierarchy together and makes LSIs viable for small / medium operators, but
a mega-chain with many thousands of cars per state approaches the 10 GB cap and
should shift to GSI-based alternate sorts (or repartition by type).

### Cascade ordering (invariant preservation)

Mass operations over hierarchical data must run in an order that preserves invariants
under partial failure, so that a failed operation can be restarted safely. The general
rule:

- **Destructive phase (delete, or the delete-half of move) is leaf-first.** Children
  before parents. Partial failure leaves a subtree with fewer leaves but no orphans; the
  parent still owns a valid (if smaller) set of children.
- **Constructive phase (create, copy, or the copy-half of move) is root-first.** Parent
  before children. Partial failure leaves a partial new tree with intact ancestry; child
  records always reference a parent that exists.
- **Move = copy + delete.** Copy phase root-first; delete phase leaf-first. Two passes.
- **`mapFn` on clone / move** can rewrite keys and attributes on the fly — this is how
  name-mangling (e.g., "clone all Texas records as Florida records") is expressed.

### Resumability via idempotent phases

Stronger than cursor-based resume: each mass-op primitive is itself idempotent, so a
retry after any failure converges to the correct state without needing a persisted
cursor. Not a real transaction model, but practical and robust.

- **Copy-if-not-exists.** Per-item `ConditionExpression: attribute_not_exists(<pk>)`.
  An item that already exists at the destination is skipped (not an error). A partial
  copy can be re-run; previously-copied items are no-ops. Works with `mapFn` — the
  destination key is computed per item.
- **Delete-if-exists.** Per-item `ConditionExpression: attribute_exists(<pk>)`. An
  item that is already gone is skipped. Partial delete is re-runnable.
- **Rename = copy-if-not-exists (with `mapFn`) + delete-if-exists of originals.** Two
  idempotent phases. If the process crashes during phase 1, re-run phase 1; if during
  phase 2, re-run phase 2. Data is never lost (source exists until phase 2 completes)
  and never duplicated (destination exists before phase 2 starts).
- **Clone-with-overwrite = delete-if-exists of destination keys (with `mapFn`) +
  copy-if-not-exists with same `mapFn`.** Same two-phase pattern.

Because the primitives are idempotent, **the cursor (A5) is an efficiency optimisation,
not a correctness requirement.** A worker that loses its cursor can simply re-run the
whole operation; it will converge. Cursor makes the re-run cheap; idempotency makes the
re-run safe. This simplifies the A5 scope — we can ship idempotent mass-op options
without waiting for the cursor surface, and add cursor later as an ergonomics pass.

Return shape for these ops must distinguish **processed** (write actually performed),
**skipped** (condition already satisfied — existed for copy, absent for delete), and
**failed** (something else went wrong). Caller uses `skipped` to measure how much of a
re-run was redundant; `failed` is the recovery list.

### Concurrency and cursor semantics

Cursors are **live pointers**, not snapshots. Between cursor persistence and cursor
resume, other writes can mutate the scanned range freely. DynamoDB's `LastEvaluatedKey`
is a position in key order, not a snapshot handle; Query and Scan are eventually
consistent by default.

**Scenarios, triaged against the idempotent-phases model:**

| Scenario | Handled by idempotent phases | Residual |
| --- | --- | --- |
| Item at cursor deleted | ✓ `ExclusiveStartKey` is positional, not identity-bound | — |
| Item in already-processed range deleted | ✓ we processed old state; rerun converges | — |
| Item in already-processed range modified | partial — we acted on stale state | **real: edit case** |
| Item inserted in already-processed range | ✗ invisibly missed | **real: completeness** |
| Item inserted post-cursor | ✓ processed | minor: unintended inclusion |
| Item migrated across cursor boundary (delete + put) | ✗ may be missed or double-processed | **real: key-move case** |

**Mitigations the toolkit should ship:**

- **Per-item optimistic concurrency via a `versionField`.** Adapter option; when set,
  the toolkit auto-injects `ConditionExpression: <versionField> = :v` on writes and
  increments on success. `edit` uses the previously-read version as `:v`. Conflicts
  surface as `ConditionalCheckFailedException` and land in the mass-op `failed`
  bucket with reason code; caller retries after re-reading. Covers the *modification
  during scan* case cleanly.
- **Scope-freeze via `createdAt ≤ T` filter.** Mass ops accept an optional
  operation-start timestamp; the toolkit emits a FilterExpression. Requires the
  caller's schema to carry a timestamp field; toolkit provides the helper, not a
  mandate. Covers most of the *insertion during scan* case — new inserts after `T`
  are excluded.
- **Clear documentation of non-coverage.** The *key-migration across cursor boundary*
  case (item renamed while mid-scan) is rare and not worth engineering around.
  Callers who need strict atomicity lock the range at the application level (e.g.,
  set a `locked: true` flag on the parent before a cascade, clear after).

**Impact on the database:**

- Extra reads when retry-on-conflict triggers (bounded by caller retry budget).
- Extra failed writes when `ConditionExpression` catches stale reads. One RCU + one
  WCU wasted per failed attempt. Negligible except at pathological conflict rates.
- No hot-partition risk specifically from cursor-based operations.
- Lambda retry budgets bound the amplification.

**Interaction with idempotent phases.** Idempotent phases (`copy-if-not-exists`,
`delete-if-exists`) already handle deletion-during-scan and re-run convergence.
`versionField` and `createdAt ≤ T` complete the story for `edit` and for bounded-scope
operations. Together they cover the practical concurrency surface; what remains is a
documentation problem, not a code problem.

### Operations surface

- `mapFn` on clone / move / cloneList / moveList / copyList / cloneByKeys / moveByKeys /
  cloneAllByParams / moveAllByParams is a first-class mechanism and already present in
  v3.1.2.
- **Projection is the default orientation, not decoration.** List and single-item
  reads typically return one of two shapes:
  - **Keys only** — used for delete workflows, parent-id lookups, and two-phase
    retrieval patterns.
  - **A caller-specified field subset** (`?fields=name,date,desc`) — used for table
    and list UI rendering. Requesting a handful of fields from wide items is where
    the bulk of real-world RCU savings come from; a 2 KB row reduced to 100 bytes is
    a 20× improvement per read.

  **Mechanism (already in v3.1.2, verified in code):** every read path pushes
  `ProjectionExpression` to DynamoDB server-side when the caller supplies `fields`:
  `getByKey`, `getByKeys`, `getAllByParams`, and indirect-GSI second-hop reads. The
  REST handler's `parseFields` threads `?fields=` through to `options.fields`, which
  becomes `ProjectionExpression` at the command boundary — a web app building
  `?fields=name,date` pays the RCU for exactly those columns, no more.
  `deleteAllByParams` auto-projects to `keyFields` so mass delete reads key-only rows
  rather than wasting RCU on full items. Indirect GSIs chain projection across the
  two hops.

  **Residual gap:** no keys-only shortcut for list reads. Callers must enumerate
  `keyFields` explicitly (`?fields=state,rentalName,carVin`). A `?keys` /
  `?fields=*keys` / `keysOnly=true` shorthand would be ergonomic and is logged as
  Q33. Future `editAllByParams` must project to the fields its `mapFn` reads and
  writes — tied to Q24.

  **Pedagogical implication for W1 / W2:** teach projection centrality up front.
  Programmers from SQL backgrounds may instinctively `SELECT *` equivalents without
  realising the RCU cost in DynamoDB. The `?fields=` parameter is one of the highest-
  leverage things they can do for their end users; the wiki should say so early and
  often.
- **Built-in marshalling helpers for standard JS classes.** Low-effort value-add: ship
  named helpers for the common cases that `prepare` / `revive` would otherwise re-
  implement in every project. Minimum set:
  - `marshallMap(m)` / `reviveMap(entries)` — `Map` ↔ entries array (or plain object,
    whichever is picked). Handles the most common non-auto-marshalled type.
  - `marshallDate(d)` / `reviveDate(s)` — `Date` ↔ ISO string (sortable) or epoch
    number (compact; trivially indexable on a sort key).
  - Possibly `marshallRegExp` / `reviveRegExp` (source + flags), `marshallURL` /
    `reviveURL` (trivial but named for consistency).

  Shipped as standalone functions the user wires into their `prepare` / `revive`; not
  a declarative schema layer (that is a bigger design with tradeoffs — Q31).
- **`edit(mapFn)` — proposed mass-op primitive for in-place, non-key modification.**
  Typical `mapFn` changes a single non-key field (e.g., appending `_copy` to a display
  name; flipping a status; bumping a counter). The current clone/move shape is
  inefficient for this case because it reads every field and writes every field back as
  a `PutItem`. `edit(mapFn)` instead reads, runs the mapFn, diffs against the input,
  and emits an `UpdateCommand` patch carrying only the changed fields. Distinct from
  `clone` / `move` / `patch`:
  - **Non-key fields only.** If the mapFn's diff touches any `keyFields` entry, `edit`
    refuses with a clear error directing the caller to `move` (which handles
    delete-then-put correctly across the key change). Silent promotion would change
    cost and correctness characteristics without the caller noticing.
  - **Wire-level shape.** Individual `UpdateCommand`s per item (BatchWriteItem cannot
    carry updates). Toolkit concurrency-caps to avoid overwhelming the table.
  - **Resumability.** `edit` is *caller-idempotent*: whether a retry is safe depends
    on the mapFn (e.g., `status = 'archived'` is idempotent; `name = name + '_copy'`
    is not). The toolkit does not enforce this; callers who need resume-safety write
    idempotent mapFns or layer optimistic concurrency on top (own version field +
    `ConditionExpression`). Cursor-based resume (A5) still applies for efficiency.
  - **Replaces v2 custom-coding.** In v2 this pattern was user-coded because the
    read-all-write-all shape of clone was wasteful. Shipping `edit` closes that gap
    once.
- **Pagination: `offset`/`limit` is the default** (CRUD UX, saveable/shareable page
  URLs). `?cursor=…` is an alternative for deep pagination where `offset`'s read-cost on
  DynamoDB matters. The underlying mechanism (`LastEvaluatedKey`) is shared with the
  cursor used by mass-op resume.

### Filter surface (sketch, not yet final)

- **`flt-<field>-<op>=<value>`** is a promising generalisation of `?prefix=`. The
  compiler auto-promotes index-compatible conditions to `KeyConditionExpression`.
- **Allowlist is non-optional.** The adapter declares `{filterable: {field: [ops]}}`.
  Parser rejects anything outside with 400. Type coercion rides along from the adapter
  schema. Authorisation is still a separate concern (a `prepareListInput` hook), not the
  same as allowlist.
- **Multi-value operators: pairs first (`ge` + `le`), not delimited values.** The
  compiler merges pairs on the same field into a single `BETWEEN` KeyCondition when the
  field is the sort key.
- **Text search is orthogonal.** Handled by an external index (OpenSearch, Algolia,
  etc.) synced via DynamoDB Streams; the adapter takes returned keys and BatchGets the
  records. Not fused into the `flt-` shape.

### Asynchronous mass operations

- **Async orchestration belongs at the message-queue layer, not inside the toolkit.**
  The application wires the toolkit into SQS / SNS / EventBridge / Step Functions / etc.
  The toolkit's responsibility is to provide the primitives.
- **Required primitives (all close to hand in v3.1.2):**
  - Cursor / resume token on mass ops (A5) — pause, persist, resume across process
    boundaries and Lambda invocations.
  - Idempotency handles — `clientRequestToken` on transactions, shipped in 3.1.0.
  - Chunked iteration — a worker picks up a bounded batch of keys to process per
    invocation; already supported implicitly by the mass-op page loop, needs a
    caller-visible surface.
- **A7 (a separate `TaskAdapter` concept) is demoted to "verify and document".** With
  A5 in place, a queue-backed mass-op processor should be an application-level exercise
  with a wiki recipe, not a toolkit feature. Audit the current toolkit for what is
  genuinely missing before designing anything new.

## Open design questions (parked for later)

Unanswered questions, logged as they arise so they do not get lost. Each is a yes/no or
choose-one; we will answer them when we sit down for the proper design pass.

### Scope and release sequencing

1. **A6' (invariant-preserving declarative cascade) — 3.x minor or 4.0?** Additive if we
   keep refusal-as-default for undeclared relationships; breaking if the relationship
   declaration is intrusive on existing Adapter shape.
2. **W1 (hierarchical wiki walkthrough) — draft now against current toolkit, or wait
   until A1' helpers ship?** Drafting now would shape A1' from the user-facing side;
   waiting would let the wiki code samples use final helper names.
3. **Queue write-through.** Move the revised action plan into
   `projects/dynamodb-toolkit/queue.md` now, or hold for one more design round?

### Filter grammar

4. **Single `flt-` prefix with auto-promotion, or dual (`key-` forces KeyCondition + 400
   if field not indexed; `flt-` is Filter-with-auto-promotion)?** Single is simpler;
   dual is more explicit.
5. **Operator vocabulary.** Pin two-letter (`ge`) or three-letter (`gte`) once, so we
   do not end up with synonyms. Follow Django/SQLAlchemy (`eq`, `ne`, `lt`, `lte`, `gt`,
   `gte`, `startswith`, `contains`, `in`) or a local shorthand?
6. **Where does `filterable` live?** Adapter schema, route pack, or separate config
   object? Probably adapter (schema info), but confirm.
7. **Does `?prefix=` remain a named convention, or is it absorbed into
   `flt-<level-field>-beg=…`?** If absorbed, `?prefix=` is documented as shorthand; if
   separate, both coexist with clear docs on when each applies.
8. **Multi-value operators beyond pairs.** Stop at pairs (`ge` + `le`), or add explicit
   `btw`, `in`, etc. with delimiter-escape rules?

### Hierarchy and routing

9. **GSI selection in URL** — *resolved.* Both conventions are accepted: URL-driven
   (path segment or meta-marker) when the GSI maps to a distinct access pattern, and
   query-param-driven (implied by `?sort=…` or a filter) when the GSI is an
   optimisation detail. Narrower remaining question: what is the declarative shape on
   the Adapter for the field → GSI mapping, and how is the "when to decline the index"
   rule expressed?
10. **Cascade refusal vs. silent drop on undeclared relationships.** When an adapter has
    no declared parent-child relationship and a DELETE hits a non-leaf URL, do we refuse
    (400) or proceed with a single-row delete (current behaviour)? Refusal is safer but
    breaks today's callers.
11. **Text search convention.** Adopt a `?q=<text>` handled by an app-defined search
    hook (returns keys → BatchGet), or leave it entirely to the adapter author with no
    toolkit-level convention?

### Helpers and shapes

12. **A1' helper signatures.** `beginsWithOnStructuralIndex(params, token)` — exact
    shape, where does it live (`rest-core` or `expressions`), how does it interact with
    an already-partially-populated `KeyConditionExpression`?
13. **Type-detector helper shape.** `{discriminatorField?, keyPresenceMap}` →
    `(record) => type`. Does it return a string, or an adapter reference? How does it
    fit into a multi-type table served by multiple Adapters?
14. **Cursor shape for mass-op resume.** `{done, cursor, processed}` is the sketch. Does
    `cursor` encode the `LastEvaluatedKey` opaquely (base64'd), or does it expose
    structure? Opaque is safer; structured helps debugging.
15. **Async mass-op foundation (A7)** — *resolved.* No separate `TaskAdapter`. Async
    orchestration is an application concern implemented against SQS / SNS / Step
    Functions / etc.; the toolkit provides A5 (cursor), `clientRequestToken`
    (idempotency), and a caller-visible chunked-iteration surface. Narrower remaining
    questions fall out as Q19 below.
16. **Adapter GSI schema.** How does an Adapter declare its GSIs and the field → GSI
    mapping? A schema option on the Adapter, a separate `indices` config, or something
    else? This is the narrower remaining piece of Q9.
17. **Sparse-GSI-by-absence writing.** Does the toolkit provide helpers for
    conditionally including / excluding technical fields based on object type during
    `prepare()`, or is that fully user-code? A small per-type `prepareFields` hook
    could make this ergonomic without being intrusive.
18. **Sort-parameter → GSI inference.** Explicit hint
    (`?sort=name&useIndex=by-name`) or automatic from the Adapter's index schema? If
    automatic, do we need an override escape hatch for the case where the adapter
    wants to force main-table scan + sort?
### Idempotent-phases mass-op shape

20. **Idempotent options vs. dedicated primitives.** Do we add
    `{ifNotExists: true}` / `{ifExists: true}` as options on existing mass ops
    (`cloneByKeys`, `deleteAllByParams`, etc.), or ship dedicated primitives
    (`copyIfNotExists`, `deleteIfExists`)? Options are ergonomically cleaner and reuse
    current APIs; primitives are more explicit in code review.
21. **Return shape.** `{processed, skipped, failed, cursor?}` — is this the right
    partition? `skipped` for condition-satisfied-no-op, `failed` for the recovery
    list. Does `failed` carry full item details or just keys?
22. **Composed macros.** Does the toolkit ship `rename(...)` (copy-if-not-exists +
    delete-if-exists) and `cloneWithOverwrite(...)` (delete-if-exists + copy-if-not-
    exists) as convenience, or is composition left to the caller? Argument for
    shipping: the correct phase order is non-obvious (destructive-before-constructive
    for overwrite; constructive-before-destructive for rename); shipping prevents
    users from getting the order wrong. Argument against: more API surface.
23. **`mapFn` × existence check.** The destination key can only be known after
    `mapFn` runs, so existence checks cannot be pre-batched. Per-item Put with
    `ConditionExpression` is the natural implementation. Verify there is no
    significant perf penalty vs. BatchWriteItem (which cannot carry per-item
    conditions). Possibly some ops stay BatchWrite when no `mapFn` and no check
    are requested.
24. **`edit(mapFn)` diff mechanics.** Three options for how the toolkit knows which
    fields changed: (a) mapFn returns the full object, toolkit computes the diff
    against the input (simple, implicit); (b) mapFn returns an explicit patch
    descriptor (`{patch: {...}, remove: [...]}`) — more verbose but explicit in code
    review; (c) Proxy-based read-and-write tracking (no caller declaration, runtime
    cost). I lean (a): callers already write mapFns in this shape for clone/move, so
    the ergonomics carry over. Also: does `edit` accept a `readFields` option to
    project-limit the Read, or always read the full item and optimise only the Write?
25. **`edit` × key-field change detection.** How does the toolkit detect that the
    mapFn's diff touched a `keyFields` entry, and what does it do? Options: (a)
    throw immediately with "use `move` instead"; (b) auto-promote to a move
    (silent); (c) accept a flag `{allowKeyChange: true}` that opts into the
    auto-promotion explicitly. I lean (a) — silent promotion changes cost
    (BatchWrite-amount of work vs. single-Update) and hides a semantic shift.

### Concurrency-support mechanisms

26. **`versionField` Adapter option — exact shape.** Opt-in per Adapter with
    `{versionField: 'v'}`; the toolkit auto-injects `ConditionExpression` on writes
    and auto-increments. Open: what about the initial insert (no prior version)?
    Probably: `attribute_not_exists(<pk>) OR <versionField> = :v`. Also: does the
    toolkit increment the version for patch operations, or only when the caller
    explicitly touches it? Auto-increment is cleaner but surprising on `patch`.
27. **`createdAt ≤ T` scope-freeze helper.** Ships as what — an option on mass ops
    (`{asOf: Date}`), a FilterExpression builder the adapter writer composes, or a
    bulk `prepareListInput` override? Requires the caller's schema to carry a
    timestamp field; the toolkit neither mandates nor auto-manages it. Naming: is
    `asOf` the right word, or `scopedAt`, or `snapshot`?
28. **Conflict-failure surfacing.** When `ConditionExpression` fails mid-mass-op
    because of a version conflict, does it land in `failed` (retry-worthy) or
    `conflicts` (separate bucket)? Separating them helps the caller distinguish
    "something broke, fix before retry" from "race lost, safe to retry". I lean
    separate bucket.
29. **Key-migration across cursor boundary — documented non-coverage.** How
    prominently does the wiki warn about this case, and how explicit is the
    application-level-lock recommendation? Possibly a dedicated "Caveats" section
    in W6 (mass-operation semantics).
30. **Missed-item sweep.** Does the toolkit offer a post-mass-op sweep pass
    (re-scan, re-apply idempotent phase) as a convenience, or is this entirely
    caller-composed? The idempotent phases already make re-scan safe — question
    is ergonomic packaging.

### Marshalling helpers

31. **Scope and API shape for standard-class marshalling.** Minimum set is
    `marshallMap` / `reviveMap` and `marshallDate` / `reviveDate`. Open questions:
    (a) which others pay off — `RegExp`, `URL`, maybe `Error`, Temporal API types
    when they reach stage 4? (b) do the helpers live in a new `marshalling/`
    submodule, or fold into an existing one (`paths/`, `adapter/`)? (c) API shape
    — standalone functions the caller wires into `prepare` / `revive`
    (simple, composable), or a declarative per-field schema like
    `{marshalling: {tags: 'map', createdAt: 'date'}}` that auto-builds `prepare` /
    `revive` (ergonomic but starts duplicating the adapter schema)? I lean
    standalone functions for the first pass — the schema version is a bigger
    design conversation and can come later if demand warrants.
32. **Date encoding.** ISO string (sortable lexicographically, human-readable,
    GSI-friendly as a sort key) or epoch number (compact, no timezone surprises,
    also sortable)? Both have use cases. Possibly ship both
    (`marshallDateISO` / `marshallDateEpoch`) with a recommendation rather than
    picking one.

### Projection ergonomics

34. **Strong-consistency on index-backed queries.** `GetOptions.consistent: true`
    already threads `ConsistentRead` through. DynamoDB accepts it on base-table and
    LSI Query; rejects it on GSI Query. What does the toolkit do when the caller
    asks for consistent read on a GSI-backed query? Options: (a) refuse up front
    with a clear error; (b) silently fall back to eventually consistent; (c)
    surface DynamoDB's native rejection unchanged. I lean (a) — refusal is
    explicit and prevents silent correctness surprises.
35. **LSI vs. GSI selection when both apply.** For a partition-bounded query with
    a requested sort, if both an LSI and a GSI would satisfy it, the toolkit
    should prefer LSI (cheaper, consistency-capable). Open: is this an automatic
    preference from the index schema, or does the caller have to hint? I lean
    automatic with an explicit override (`useIndex: 'explicit-name'`) for the
    rare case where the caller knows better.
36. **10 GB per-partition LSI hazard.** Runtime detection is impractical and the
    toolkit cannot guard against it. Open: do we add a check at `prepare()` time
    that refuses writes when the partition is approaching the cap (requires a
    size query), or is this entirely a design-time documentation problem? I
    lean documentation only — runtime guards cost RCU for every write.

33. **Keys-only list shortcut.** Callers that want just the keys today must write
    `?fields=state,rentalName,carVin` — verbose and breaks encapsulation because
    the caller has to know the key schema. Options: (a) `?keys` (boolean query
    flag, smallest URL); (b) `?fields=*keys` (wildcard-marker style, consistent
    with a future `*` for "everything"); (c) `keysOnly=true` on the programmatic
    API with a query-param alias. This interacts with Q4 / Q7 on filter grammar:
    whatever wildcard convention we pick should generalise (e.g., if we later
    add `?fields=*all` for full projection, the `*keys` form fits). I lean
    `?fields=*keys` for consistency with the eventual fields-wildcard family.

19. **Async primitives audit (verify, not build)** — *resolved.* Toolkit is closer
    than expected. Already present:
    - `iterateList` / `iterateItems` async generators
      (`src/mass/iterate-list.js:7-22`) — yield pages with `LastEvaluatedKey` on each.
      A worker can drive them, break mid-loop, serialise the cursor to SQS, and a
      second worker resumes. This is the primitive for queue-backed workers today.
    - `clientRequestToken` on transactions (`src/batch/apply-transaction.js:53`).
    - `explainTransactionCancellation` for per-action transaction failures
      (`src/batch/explain-transaction.js:20-41`).

    Three concrete gaps, all converging into A5:
    (a) no `maxItems` option or `resumeToken` / `cursor` return on higher-level mass
    ops — `deleteAllByParams`, `cloneAllByParams`, `moveAllByParams`, `deleteList`,
    `copyList`, `moveList` (`src/adapter/adapter.js:314-345` + `src/mass/*`) are all
    await-until-done, dropping the underlying `LastEvaluatedKey` on the floor;
    (b) no per-item failure breakdown from `applyBatch` — `UnprocessedItems` retried
    up to 8 times then thrown as one generic error (`src/batch/apply-batch.js:31-51`,
    `src/batch/batch-write.js:12-28`);
    (c) no idempotency on `applyBatch` or single-item writes — only transactions
    have `clientRequestToken` (BatchWriteItem API lacks one; single-item writes
    could expose one).

    Scope for A5 crystallised: add `{maxItems, resumeToken}` options and
    `{processed, failed, cursor?}` return to Adapter mass ops (plumbing only — the
    generators underneath already support it); surface failed-item keys from
    batch-write retries; write the W6 wiki recipe for queue-backed workers. No
    `TaskAdapter` needed; no new architecture.
