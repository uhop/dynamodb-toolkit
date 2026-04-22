// Mixed car + boat seed data across three states. Priced in cents
// (integer) to keep DynamoDB number encoding honest.
//
// Car shape: {state, facility, vehicle: vin, kind: 'car', status,
//             dailyPriceCents, make, model, year}
// Boat shape: {state, facility, vehicle: hull, kind: 'boat', status,
//              dailyPriceCents, length, motorHP}

export const seedVehicles = [
  // TX ▸ Dallas
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

  // TX ▸ Austin
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

  // FL ▸ Miami
  {state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-001', kind: 'car', status: 'available', dailyPriceCents: 5000, make: 'Toyota', model: 'RAV4', year: 2022},
  {state: 'FL', facility: 'Miami', vehicle: 'VIN-FL-002', kind: 'car', status: 'available', dailyPriceCents: 9500, make: 'Porsche', model: '911', year: 2024},
  {state: 'FL', facility: 'Miami', vehicle: 'HULL-FL-100', kind: 'boat', status: 'available', dailyPriceCents: 35000, length: 32, motorHP: 500},
  {state: 'FL', facility: 'Miami', vehicle: 'HULL-FL-101', kind: 'boat', status: 'rented', dailyPriceCents: 28000, length: 26, motorHP: 350},
  {state: 'FL', facility: 'Miami', vehicle: 'HULL-FL-102', kind: 'boat', status: 'maintenance', dailyPriceCents: 15000, length: 18, motorHP: 135},

  // CA ▸ LA
  {state: 'CA', facility: 'LA', vehicle: 'VIN-CA-001', kind: 'car', status: 'rented', dailyPriceCents: 12000, make: 'Mercedes', model: 'S-Class', year: 2024},
  {state: 'CA', facility: 'LA', vehicle: 'VIN-CA-002', kind: 'car', status: 'available', dailyPriceCents: 7500, make: 'Tesla', model: 'Model Y', year: 2023}
];
