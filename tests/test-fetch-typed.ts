// TypeScript smoke test — demonstrates dynamodb-toolkit/fetch is usable from
// typed consumers and that the published `.d.ts` sidecars flow typing through
// the public API.
//
// Manual — not wired into `npm test`. Invocations:
//   npm run ts-check          # type-checks this file (tsconfig includes tests/**/*)
//   npm run ts-test           # executes via tape-six on Node >= 22.6
//   npm run test:bun          # also picks this file up (Bun runs .ts natively)
//   npm run test:deno         # also picks this file up (Deno runs .ts natively)

import test from 'tape-six';
import {Adapter} from 'dynamodb-toolkit';
import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

import {createFetchAdapter, type FetchAdapterOptions} from 'dynamodb-toolkit/fetch';

interface Planet extends Record<string, unknown> {
  name: string;
  climate?: string;
  diameter?: number;
}

type PlanetKey = Pick<Planet, 'name'>;

// Minimal client stub — satisfies the DocumentClient shape for the slice of
// the interface the Adapter touches in this smoke test.
const makeClient = <T>(handler: (cmd: unknown) => Promise<T>): DynamoDBDocumentClient => ({send: handler}) as unknown as DynamoDBDocumentClient;

const makeTypedAdapter = () =>
  new Adapter<Planet, PlanetKey>({
    client: makeClient(async () => ({})),
    table: 'Planets',
    keyFields: ['name']
  });

test('typed: createFetchAdapter returns a Fetch handler returning Response', t => {
  const adapter = makeTypedAdapter();
  const handler: (req: Request) => Promise<Response> = createFetchAdapter(adapter);
  t.equal(typeof handler, 'function');
  t.equal(handler.length, 1, 'handler takes (request)');
});

test('typed: FetchAdapterOptions typechecks the full options surface', t => {
  const adapter = makeTypedAdapter();

  const opts: FetchAdapterOptions<Planet> = {
    policy: {defaultLimit: 25, maxLimit: 200, needTotal: false},
    sortableIndices: {name: 'by-name-index'},
    keyFromPath: (raw, adp) => ({[adp.keyFields[0].name]: raw}),
    exampleFromContext: ({query, request}) => ({tenant: query.tenant ?? 'default', via: request.method}),
    maxBodyBytes: 128 * 1024,
    mountPath: '/planets'
  };

  const handler = createFetchAdapter(adapter, opts);
  t.equal(typeof handler, 'function');
});

test('typed: envelope keys override via policy', t => {
  const adapter = makeTypedAdapter();
  const handler = createFetchAdapter(adapter, {
    policy: {envelope: {items: 'rows', total: 'count', offset: 'skip', limit: 'take', links: 'links'}}
  });
  t.equal(typeof handler, 'function');
});

test('typed: composite keyFromPath yields the right key shape', t => {
  interface TenantedPlanet extends Record<string, unknown> {
    pk: string;
    sk: string;
  }
  type TenantedKey = Pick<TenantedPlanet, 'pk' | 'sk'>;

  const adapter = new Adapter<TenantedPlanet, TenantedKey>({
    client: makeClient(async () => ({})),
    table: 'MultiTenantPlanets',
    keyFields: ['pk', 'sk'],
    structuralKey: {name: '-sk'}
  });

  const handler = createFetchAdapter(adapter, {
    keyFromPath: raw => {
      const [pk, sk] = raw.split(':');
      return {pk, sk};
    }
  });
  t.equal(typeof handler, 'function');
});

test('typed: onMiss widens return type to Response | null', t => {
  const adapter = makeTypedAdapter();
  // With onMiss, the handler's return type is Promise<Response | null>.
  const handler: (req: Request) => Promise<Response | null> = createFetchAdapter(adapter, {
    onMiss: () => null
  });
  t.equal(typeof handler, 'function');
});
