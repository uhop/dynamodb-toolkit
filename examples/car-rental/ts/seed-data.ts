// Typed seed data — mirrors seed-data.js. Each record is declared as the
// full interface so downstream consumers can narrow on `kind`.

import type {StateRecord, FacilityRecord, CarRecord, BoatRecord, AnyRecord} from './adapter.ts';

export const seedStates: StateRecord[] = [
  {state: 'TX', manager: {name: 'Jane Ramos', email: 'jane@tx.example.com', phone: '+1-555-0101'}, managedSince: new Date('2021-03-14T00:00:00Z')},
  {state: 'FL', manager: {name: 'Luis Ortega', email: 'luis@fl.example.com', phone: '+1-555-0202'}, managedSince: new Date('2022-07-01T00:00:00Z')},
  {state: 'CA', manager: {name: 'Priya Patel', email: 'priya@ca.example.com', phone: '+1-555-0303'}, managedSince: new Date('2019-11-20T00:00:00Z')}
];

export const seedFacilities: FacilityRecord[] = [
  {
    state: 'TX',
    facility: 'Dallas',
    address: '1200 Commerce St, Dallas, TX 75202',
    manager: {name: 'Bob Chen', email: 'bob@dallas.tx.example.com', phone: '+1-555-0110'}
  },
  {
    state: 'TX',
    facility: 'Austin',
    address: '301 Congress Ave, Austin, TX 78701',
    manager: {name: 'Alice Wu', email: 'alice@austin.tx.example.com', phone: '+1-555-0120'}
  },
  {
    state: 'FL',
    facility: 'Miami',
    address: '100 Biscayne Blvd, Miami, FL 33132',
    manager: {name: 'Carlos Rivera', email: 'carlos@miami.fl.example.com', phone: '+1-555-0210'}
  },
  {
    state: 'CA',
    facility: 'LA',
    address: '1 World Way, Los Angeles, CA 90045',
    manager: {name: 'Dana Kim', email: 'dana@la.ca.example.com', phone: '+1-555-0310'}
  }
];

export const seedVehicles: (CarRecord | BoatRecord)[] = [
  {state: 'TX', facility: 'Dallas', vehicle: 'VIN-TX-001', kind: 'car', status: 'available', dailyPriceCents: 4500, make: 'Toyota', model: 'Camry', year: 2023},
  {state: 'TX', facility: 'Dallas', vehicle: 'VIN-TX-002', kind: 'car', status: 'rented', dailyPriceCents: 8500, make: 'BMW', model: 'X5', year: 2024},
  {
    state: 'TX',
    facility: 'Dallas',
    vehicle: 'VIN-TX-003',
    kind: 'car',
    status: 'maintenance',
    dailyPriceCents: 3500,
    make: 'Honda',
    model: 'Civic',
    year: 2021
  },
  {state: 'TX', facility: 'Dallas', vehicle: 'HULL-TX-100', kind: 'boat', status: 'available', dailyPriceCents: 22000, length: 22, motorHP: 250},

  {
    state: 'TX',
    facility: 'Austin',
    vehicle: 'VIN-TX-010',
    kind: 'car',
    status: 'available',
    dailyPriceCents: 5500,
    make: 'Tesla',
    model: 'Model 3',
    year: 2023
  },
  {state: 'TX', facility: 'Austin', vehicle: 'VIN-TX-011', kind: 'car', status: 'rented', dailyPriceCents: 6500, make: 'BMW', model: '330i', year: 2024},
  {state: 'TX', facility: 'Austin', vehicle: 'HULL-TX-110', kind: 'boat', status: 'rented', dailyPriceCents: 18000, length: 18, motorHP: 150},

  {state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-001', kind: 'car', status: 'available', dailyPriceCents: 5000, make: 'Toyota', model: 'RAV4', year: 2022},
  {state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-002', kind: 'car', status: 'available', dailyPriceCents: 9500, make: 'Porsche', model: '911', year: 2024},
  {state: 'FL', facility: 'Miami', vehicle: 'HULL-FL-100', kind: 'boat', status: 'available', dailyPriceCents: 35000, length: 32, motorHP: 500},
  {state: 'FL', facility: 'Miami', vehicle: 'HULL-FL-101', kind: 'boat', status: 'rented', dailyPriceCents: 28000, length: 26, motorHP: 350},
  {state: 'FL', facility: 'Miami', vehicle: 'HULL-FL-102', kind: 'boat', status: 'maintenance', dailyPriceCents: 15000, length: 18, motorHP: 135},

  {state: 'CA', facility: 'LA', vehicle: 'VIN-CA-001', kind: 'car', status: 'rented', dailyPriceCents: 12000, make: 'Mercedes', model: 'S-Class', year: 2024},
  {state: 'CA', facility: 'LA', vehicle: 'VIN-CA-002', kind: 'car', status: 'available', dailyPriceCents: 7500, make: 'Tesla', model: 'Model Y', year: 2023}
];

export const seedAll: AnyRecord[] = [...seedStates, ...seedFacilities, ...seedVehicles];
