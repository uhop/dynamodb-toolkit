// Car-rental Adapter — typed mirror of adapter.js.
//
// Exists to gauge the TypeScript story on a realistic multi-tier
// hierarchy with discriminated leaf types. Every record shape is
// declared up front; the Adapter is instantiated as
// `Adapter<AnyRecord>` so compile-time shape checks flow through
// writes, reads (after discrimination), and subtree macros.

import {Adapter, stampCreatedAtISO, type DynamoDBDocumentClient} from 'dynamodb-toolkit';
import {marshallDateISO, unmarshallDateISO} from 'dynamodb-toolkit/marshalling';

export const TABLE = 'car-rental-example-ts';

export interface Manager {
  name: string;
  email: string;
  phone: string;
}

// Each record type extends `Record<string, unknown>` so it satisfies
// the `Adapter<TItem extends Record<string, unknown>>` constraint.
// The adapter adds `_version`, `_createdAt`, `_sk` etc. at runtime, so
// the types have to stay open at the index-signature level; known
// properties are still declared and narrowed the usual way.

export interface StateRecord extends Record<string, unknown> {
  state: string;
  manager: Manager;
  managedSince: Date;
  /** Auto-populated by `typeField` on write. */
  kind?: 'state';
}

export interface FacilityRecord extends Record<string, unknown> {
  state: string;
  facility: string;
  address: string;
  manager: Manager;
  kind?: 'facility';
}

export interface CarRecord extends Record<string, unknown> {
  state: string;
  facility: string;
  vehicle: string;
  kind: 'car';
  status: 'available' | 'rented' | 'maintenance';
  dailyPriceCents: number;
  make: string;
  model: string;
  year: number;
}

export interface BoatRecord extends Record<string, unknown> {
  state: string;
  facility: string;
  vehicle: string;
  kind: 'boat';
  status: 'available' | 'rented' | 'maintenance';
  dailyPriceCents: number;
  length: number;
  motorHP: number;
}

export type VehicleRecord = CarRecord | BoatRecord;
export type AnyRecord = StateRecord | FacilityRecord | VehicleRecord;

/** Type guards usable after `adapter.typeOf(item)`. */
export const isState = (r: AnyRecord): r is StateRecord => (r as StateRecord).manager !== undefined && (r as FacilityRecord).facility === undefined;
export const isFacility = (r: AnyRecord): r is FacilityRecord => (r as FacilityRecord).facility !== undefined && (r as CarRecord).vehicle === undefined;
export const isCar = (r: AnyRecord): r is CarRecord => (r as CarRecord).kind === 'car';
export const isBoat = (r: AnyRecord): r is BoatRecord => (r as BoatRecord).kind === 'boat';

/**
 * Build the Adapter from a DocumentClient. Kept as a factory so the
 * walkthrough can instantiate against DynamoDB Local without a global
 * side effect. See adapter.js for full commentary — types mirror.
 */
export const createAdapter = (client: DynamoDBDocumentClient): Adapter<AnyRecord> =>
  new Adapter<AnyRecord>({
    client,
    table: TABLE,
    technicalPrefix: '_',
    keyFields: ['state', 'facility', 'vehicle'],
    structuralKey: '_sk',
    typeLabels: ['state', 'facility', 'vehicle'],
    typeField: 'kind',
    typeDiscriminator: 'kind',
    indices: {
      'by-status-createdAt': {
        type: 'gsi',
        pk: {name: 'status', type: 'string'},
        sk: {name: '_createdAt', type: 'string'},
        projection: 'all'
      },
      'by-price': {
        type: 'lsi',
        sk: {name: 'dailyPriceCents', type: 'number'},
        projection: 'keys-only'
      }
    },
    filterable: {
      kind: ['eq', 'in'],
      status: ['eq', 'ne', 'in'],
      dailyPriceCents: ['lt', 'le', 'gt', 'ge', 'btw'],
      make: ['eq', 'beg'],
      year: {ops: ['eq', 'ge', 'le', 'btw'], type: 'number'}
    },
    versionField: '_version',
    createdAtField: '_createdAt',
    relationships: {structural: true},
    descriptorKey: '__adapter__',
    hooks: {
      prepare: (() => {
        const stamp = stampCreatedAtISO<AnyRecord>('_createdAt');
        return (item: AnyRecord, isPatch?: boolean): AnyRecord => {
          const stamped = stamp(item, isPatch);
          if (stamped.managedSince instanceof Date) {
            // Cast: after `instanceof Date` narrowing TypeScript thinks the
            // union has collapsed to `StateRecord`, but spreading + writing
            // `managedSince: string` breaks that — the shape still covers
            // the whole union, just with one field's type swapped.
            return {...stamped, managedSince: marshallDateISO(stamped.managedSince)} as AnyRecord;
          }
          return stamped;
        };
      })(),
      revive: (item: AnyRecord): AnyRecord => {
        if (typeof item.managedSince === 'string') {
          return {...item, managedSince: unmarshallDateISO(item.managedSince)} as AnyRecord;
        }
        return item;
      }
    }
  });
