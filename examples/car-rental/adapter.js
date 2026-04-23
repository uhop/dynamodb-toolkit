// Car-rental Adapter — exercises the full 3.7.0 declaration surface.
//
// One shared Adapter covers every record tier: state records, facility
// records, and the two leaf kinds (cars + boats). The `kind` field is
// auto-populated on write (`typeField`) and read back by `typeOf` (same
// field — `typeDiscriminator` points at it). Leaf records carry their
// own explicit `kind: 'car' | 'boat'` so the discriminator short-circuits
// depth-based detection.

import {Adapter, stampCreatedAtISO} from 'dynamodb-toolkit';
import {marshallDateISO, unmarshallDateISO} from 'dynamodb-toolkit/marshalling';

export const TABLE = 'car-rental-example';

/**
 * Build the Adapter from a DocumentClient. Kept as a factory so the
 * walkthrough can instantiate against DynamoDB Local without a global
 * side effect.
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

    // Three tiers: state → facility → vehicle. Contiguous-from-start
    // partial keys let us query every tier via the structural key.
    // Strings are the F2 shorthand for `{name, type: 'string'}`.
    keyFields: ['state', 'facility', 'vehicle'],
    structuralKey: '_sk',

    // Depth-based type labels, paired 1:1 with keyFields.
    typeLabels: ['state', 'facility', 'vehicle'],
    // Same field is both auto-populated on prepare (typeField) and read
    // on typeOf (typeDiscriminator). Leaf records that carry their own
    // `kind` (car / boat) win — the built-in prepare leaves the existing
    // value alone.
    typeField: 'kind',
    typeDiscriminator: 'kind',

    indices: {
      // Sparse GSI — only records that carry `status` (i.e. vehicles)
      // appear in the index. Demonstrates "rented fleet across every
      // state, oldest-first" via a single cross-partition Query.
      'by-status-createdAt': {
        type: 'gsi',
        pk: {name: 'status', type: 'string'},
        sk: {name: '_createdAt', type: 'string'},
        projection: 'all'
      },
      // LSI: "vehicles by daily price within a state". Shares the base
      // partition (state); sk auto-promoted when the caller passes
      // `{sort: 'dailyPriceCents'}`.
      'by-price': {
        type: 'lsi',
        sk: {name: 'dailyPriceCents', type: 'number'},
        projection: 'keys-only'
      }
    },

    // Allowlist + op vocabulary for the `<op>-<field>=<value>` filter
    // grammar (e.g. `?eq-kind=car&gt-dailyPriceCents=5000`). Requests
    // naming an unlisted field or using an op not in the allowlist are
    // rejected before hitting DynamoDB. `year` uses the {ops, type}
    // shape (E6): the field isn't a keyField, so the type hint is how
    // the toolkit knows to coerce `'2024'` → `2024` on the wire.
    filterable: {
      kind: ['eq', 'in'],
      status: ['eq', 'ne', 'in'],
      dailyPriceCents: ['lt', 'le', 'gt', 'ge', 'btw'],
      make: ['eq', 'beg'],
      year: {ops: ['eq', 'ge', 'le', 'btw'], type: 'number'}
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
    // filterable allowlist, etc.). List-ops hide this row by default;
    // pass `{includeDescriptor: true}` to introspect it.
    descriptorKey: '__adapter__',

    hooks: {
      // Compose two prepare steps: the canned `stampCreatedAtISO()` from
      // the toolkit (E3 — replaces the boilerplate every `asOf`-using
      // adapter was copying), and a tiny wrapper that marshalls a
      // `Date`-typed `managedSince` field (F6 Stage 1 — demonstrates
      // wiring the existing per-field marshalling helpers through the
      // hook rather than calling them ad-hoc at every write site).
      prepare: (() => {
        const stamp = stampCreatedAtISO('_createdAt');
        return (item, isPatch) => {
          const stamped = stamp(item, isPatch);
          if (stamped.managedSince instanceof Date) {
            return {...stamped, managedSince: marshallDateISO(stamped.managedSince)};
          }
          return stamped;
        };
      })(),
      revive: item => {
        if (typeof item.managedSince === 'string') {
          return {...item, managedSince: unmarshallDateISO(item.managedSince)};
        }
        return item;
      }
    }
  });
