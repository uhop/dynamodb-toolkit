# Car rental — hierarchical example

Runnable walkthrough exercising the full 3.6.0 toolkit surface against a realistic data model: a national rental agency with **state ⇒ facility ⇒ vehicle**, where each facility rents both cars AND boats.

## Data model

- **Structural hierarchy**: `state | facility | vehicle`.
- **Multi-type same tier**: the leaf records are either `kind: 'car'` or `kind: 'boat'`. Both live in the same table, under the same keyFields; `adapter.typeOf(item)` returns `'car'` / `'boat'` via the `kind` discriminator (wins over depth-based detection).
- **Two index patterns**:
  - GSI `by-status-createdAt` — "show me every rented vehicle across the fleet, oldest first".
  - LSI `by-price` — within a single facility (partition), sort by daily price.

## What it exercises

| Feature                                                                                                                                                                                   | Where                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Typed declaration (`keyFields` / `structuralKey` / `indices` / `typeLabels` / `typeDiscriminator` / `filterable` / `versionField` / `createdAtField` / `relationships` / `descriptorKey`) | [`adapter.js`](./adapter.js)           |
| `ensureTable` + `verifyTable` + descriptor record                                                                                                                                         | [`run.js`](./run.js) §Setup, §Teardown |
| `adapter.buildKey(values, {kind})` (exact / children / partial)                                                                                                                           | §Subtree queries                       |
| `f-<field>-<op>=<value>` filter grammar (`applyFFilter`)                                                                                                                                  | §Filter grammar                        |
| Mass ops + cursor resume (`{maxItems, resumeToken}`)                                                                                                                                      | §Resumable mass ops                    |
| `adapter.edit(key, mapFn)` + `editListByParams`                                                                                                                                           | §In-place updates                      |
| `rename(from, to)` subtree macro                                                                                                                                                          | §Rename subtree                        |
| Cascade primitives (`deleteAllUnder`, `cloneAllUnder{,By}`, `moveAllUnder`)                                                                                                               | §Cascade                               |
| Optimistic concurrency (`versionField`) + scope-freeze (`asOf`)                                                                                                                           | §Concurrency                           |
| Marshalling helpers (`marshallDateISO`)                                                                                                                                                   | hook wiring in `adapter.js`            |
| `adapter.typeOf(item)` for car-vs-boat dispatch                                                                                                                                           | §Multi-type dispatch                   |

## Run it

Requires Docker (DynamoDB Local is spun up for you):

```sh
node examples/car-rental/run.js
```

The script creates a one-off table, runs the walkthrough end-to-end, prints each step's outcome, and deletes the table when done. Skips gracefully if Docker isn't available.

## Not covered

- Full REST server — the bundled `dynamodb-toolkit/handler` route pack is exercised programmatically (via `createHandler` + synthetic requests), but this example isn't a deployable service. Adapter packages (`dynamodb-toolkit-koa` etc.) wire this up for production use.
- Sparse indices, indirect indices — design space is covered by the main Adapter docs; this example keeps the index surface small.
