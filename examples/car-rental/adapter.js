// Car-rental Adapter — full 3.6.0 declaration surface.
//
// One shared Adapter covers both vehicle kinds (cars + boats). The
// `kind` discriminator wins over depth-based detection, so
// `adapter.typeOf(item)` returns `'car'` / `'boat'` at the leaf level
// and `'state'` / `'facility'` above — see the walkthrough's "Multi-
// type dispatch" section.

import {Adapter} from 'dynamodb-toolkit';

export const TABLE = 'car-rental-example';

/**
 * Build the Adapter from a DocumentClient. Kept as a factory so the
 * walkthrough can instantiate against DynamoDB Local without a
 * global side effect.
 */
export const createAdapter = client =>
  new Adapter({
    client,
    table: TABLE,

    // Adapter-managed fields live under this prefix; callers never write
    // or read them directly. The toolkit strips them on revive and
    // rejects user-written fields starting with '_' on prepare (version
    // and createdAt fields are carve-outs — users may round-trip them).
    technicalPrefix: '_',

    // Three levels: state → facility → vehicle. Contiguous-from-start
    // partial keys let us query every level via the structural key.
    keyFields: [
      {name: 'state', type: 'string'},
      {name: 'facility', type: 'string'},
      {name: 'vehicle', type: 'string'}
    ],
    structuralKey: {name: '_sk', separator: '|'},

    // Depth-based type labels. Short-circuited at the leaf by the
    // `typeDiscriminator` — a record with `kind: 'boat'` returns
    // `'boat'`, not `'vehicle'`.
    typeLabels: ['state', 'facility', 'vehicle'],
    typeDiscriminator: {name: 'kind'},

    indices: {
      // Cross-state "show me everything that's currently rented out,
      // oldest rental first".
      'by-status-createdAt': {
        type: 'gsi',
        pk: {name: 'status', type: 'string'},
        sk: {name: '_createdAt', type: 'string'},
        projection: 'all'
      },
      // Within a state (same base-table partition), sort by price.
      // LSIs inherit the base table's partition key, so "price within
      // state" rather than "price within facility".
      'by-price': {
        type: 'lsi',
        sk: {name: 'dailyPriceCents', type: 'number'},
        projection: 'keys-only'
      }
    },

    // Allowlist + op vocabulary for the `f-<field>-<op>=<value>` filter
    // grammar. Requests naming an unlisted field or using an op not in
    // the allowlist are rejected before hitting DynamoDB.
    filterable: {
      kind: ['eq', 'in'],
      status: ['eq', 'ne', 'in'],
      dailyPriceCents: ['lt', 'le', 'gt', 'ge', 'btw'],
      make: ['eq', 'beg'],
      year: ['eq', 'ge', 'le', 'btw']
    },

    // Optimistic concurrency + scope-freeze. Both opt-in; both require
    // technicalPrefix.
    versionField: '_version',
    createdAtField: '_createdAt',

    // Cascade gate — without this, `deleteAllUnder` and siblings throw
    // `CascadeNotDeclared`.
    relationships: {structural: true},

    // Opt-in reserved-record descriptor. `verifyTable` reads this to
    // detect drift that `DescribeTable` can't see (marshalling,
    // filterable allowlist, etc.).
    descriptorKey: '__adapter__',

    hooks: {
      // Stamp `_createdAt` on first insert. Patches skip; items that
      // already carry `_createdAt` (put round-trip) skip too. The
      // toolkit stamps nothing automatically — the user-hook policy is
      // "ISO format, stamped on create" for this example.
      prepare: (item, isPatch) => {
        if (isPatch || item._createdAt) return item;
        return {...item, _createdAt: new Date().toISOString()};
      }
    }
  });
