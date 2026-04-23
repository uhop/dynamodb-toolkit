// TypeScript smoke test — demonstrates dynamodb-toolkit is usable from typed
// consumers and that the published `.d.ts` sidecars flow typing through the
// public API.
//
// Manual — not wired into `npm test`. Invocations:
//   npm run ts-check              # type-checks this file (tsconfig.json includes tests/**/*)
//   node tests/test-typed.ts      # executes it (needs Node >= 22.6; unflagged on >= 23.6)
//
// Once wired into CI, move the file to `tests/test-typed-smoke.ts` (or similar)
// and extend the tape6 glob — tape-six runs `.ts` files natively on Node >= 22.

import test from 'tape-six';
import {Adapter, Raw, raw, TransactionLimitExceededError} from 'dynamodb-toolkit';
import {buildUpdate, buildCondition, cleanParams, type ConditionClause} from 'dynamodb-toolkit/expressions';
import {applyTransaction, TRANSACTION_LIMIT, backoff, type TransactWriteDescriptor} from 'dynamodb-toolkit/batch';
import type {DynamoDBDocumentClient, UpdateCommandInput} from '@aws-sdk/lib-dynamodb';

interface Planet extends Record<string, unknown> {
  name: string;
  climate?: string;
  diameter?: number;
  version?: number;
}

type PlanetKey = Pick<Planet, 'name'>;

// A minimal client stub that satisfies the `DynamoDBDocumentClient` shape for
// the slice of the interface the toolkit uses.
const makeClient = <T>(handler: (cmd: unknown) => Promise<T>): DynamoDBDocumentClient => ({send: handler}) as unknown as DynamoDBDocumentClient;

test('typed: Adapter constructs with typed item + key', t => {
  const adapter = new Adapter<Planet, PlanetKey>({
    client: makeClient(async () => ({})),
    table: 'Planets',
    keyFields: ['name'] // (keyof Planet & string)[] — compile-time checked
  });
  t.equal(adapter.table, 'Planets');
  // keyFields normalize to KeyFieldSpec objects on construction. The string
  // shorthand `'name'` is equivalent to `{name: 'name', type: 'string'}`.
  t.deepEqual(adapter.keyFields, [{name: 'name', type: 'string'}]);
});

test('typed: raw() preserves the inner type through the wrapper', t => {
  const wrapped: Raw<Planet> = raw<Planet>({name: 'Tatooine', climate: 'arid'});
  t.ok(wrapped instanceof Raw);
  t.equal(wrapped.item.climate, 'arid');
});

test('typed: expression builders compose additively over SDK params', t => {
  // Real-world shape: a caller starts from the SDK's input type and each
  // builder augments the optional expression fields in place.
  const params: UpdateCommandInput = {TableName: 'Planets', Key: {name: 'Hoth'}};
  const afterUpdate = buildUpdate({climate: 'frozen', diameter: 7200}, {delete: ['deprecated'], arrayOps: [{op: 'add', path: 'version', value: 1}]}, params);
  t.matchString(afterUpdate.UpdateExpression, /^SET /);

  const clauses: ConditionClause[] = [
    {path: 'version', op: '=', value: 1},
    {
      op: 'or',
      clauses: [
        {path: 'climate', op: 'exists'},
        {path: 'diameter', op: '>', value: 0}
      ]
    }
  ];
  const afterCondition = buildCondition(clauses, afterUpdate);
  t.matchString(afterCondition.ConditionExpression ?? '', /#cd/);

  cleanParams(afterCondition);
  t.ok(afterCondition.ExpressionAttributeNames, 'names retained');
});

test('typed: make* builders return discriminated BatchDescriptors', async t => {
  const adapter = new Adapter<Planet, PlanetKey>({
    client: makeClient(async () => ({})),
    table: 'Planets',
    keyFields: ['name']
  });

  const postD = await adapter.makePost({name: 'Mustafar', climate: 'volcanic'});
  t.equal(postD.action, 'put');
  t.matchString(postD.params.ConditionExpression ?? '', /attribute_not_exists/);

  const patchD = await adapter.makePatch({name: 'Mustafar'}, {climate: 'ashen'}, {returnFailedItem: true});
  t.equal(patchD.action, 'patch');
  t.equal(patchD.params.ReturnValuesOnConditionCheckFailure, 'ALL_OLD');

  // Descriptor arrays are typed — applyTransaction accepts the union.
  const descriptors: TransactWriteDescriptor[] = [postD, patchD];
  t.equal(descriptors.length, 2);
});

test('typed: single-op CRUD surfaces returnFailedItem', async t => {
  let sent: Record<string, unknown> | undefined;
  const adapter = new Adapter<Planet, PlanetKey>({
    client: makeClient(async (cmd: unknown) => {
      sent = (cmd as {input: Record<string, unknown>}).input;
      return {};
    }),
    table: 'Planets',
    keyFields: ['name']
  });

  await adapter.put({name: 'Hoth', climate: 'frozen'}, {returnFailedItem: true});
  t.equal(sent?.ReturnValuesOnConditionCheckFailure, 'ALL_OLD');
});

test('typed: batch helpers + TransactionLimitExceededError are exported', t => {
  t.equal(typeof applyTransaction, 'function');
  t.equal(TRANSACTION_LIMIT, 100);

  // backoff is a generator — exercising the iterator proves the type.
  const gen = backoff(10, 100, true);
  const {value, done} = gen.next();
  t.equal(typeof value, 'number');
  t.equal(done, false);

  // Error class is constructible + carries the typed `actionCount` field.
  const err = new TransactionLimitExceededError(101);
  t.equal(err.actionCount, 101);
  t.ok(err instanceof Error);
});
