// TypeScript smoke test — demonstrates dynamodb-toolkit/express is usable
// from typed consumers and that the published `.d.ts` sidecars flow typing
// through the public API.
//
// Manual — not wired into `npm test`. Invocations:
//   npm run ts-check          # type-checks this file (tsconfig includes tests/**/*)
//   npm run ts-test           # executes via tape-six on Node >= 22.6
//   npm run test:bun          # also picks this file up (Bun runs .ts natively)
//   npm run test:deno         # also picks this file up (Deno runs .ts natively)

import test from 'tape-six';
import type {RequestHandler} from 'express';
import {Adapter} from 'dynamodb-toolkit';
import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

import {createExpressAdapter, type ExpressAdapterOptions} from 'dynamodb-toolkit/express';

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

test('typed: createExpressAdapter returns an Express RequestHandler', t => {
  const adapter = makeTypedAdapter();
  const mw: RequestHandler = createExpressAdapter(adapter);
  t.equal(typeof mw, 'function');
  t.equal(mw.length, 3, 'middleware takes (req, res, next)');
});

test('typed: ExpressAdapterOptions typechecks the full options surface', t => {
  const adapter = makeTypedAdapter();

  // `ExpressAdapterOptions<Planet>` ties `keyFromPath`'s adapter arg to the
  // same item shape the Adapter was built with.
  const opts: ExpressAdapterOptions<Planet> = {
    policy: {defaultLimit: 25, maxLimit: 200, needTotal: false},
    sortableIndices: {name: 'by-name-index'},
    keyFromPath: (raw, adp) => ({[adp.keyFields[0].name]: raw}),
    exampleFromContext: ({query, req}) => ({tenant: query.tenant ?? 'default', via: req.method}),
    maxBodyBytes: 128 * 1024
  };

  const mw: RequestHandler = createExpressAdapter(adapter, opts);
  t.equal(typeof mw, 'function');
});

test('typed: envelope keys override via policy', t => {
  const adapter = makeTypedAdapter();
  const mw = createExpressAdapter(adapter, {
    policy: {envelope: {items: 'rows', total: 'count', offset: 'skip', limit: 'take', links: 'links'}}
  });
  t.equal(typeof mw, 'function');
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
    keyFields: ['pk', 'sk']
  });

  const mw = createExpressAdapter(adapter, {
    keyFromPath: raw => {
      const [pk, sk] = raw.split(':');
      return {pk, sk};
    }
  });
  t.equal(typeof mw, 'function');
});
