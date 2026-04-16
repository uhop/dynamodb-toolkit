import test from 'tape-six';
import {Raw, raw} from 'dynamodb-toolkit';

test('Raw: wrap and detect', t => {
  const item = {name: 'Tatooine'};
  const wrapped = raw(item);
  t.ok(wrapped instanceof Raw, 'raw() returns a Raw instance');
  t.equal(wrapped.item, item, 'item is preserved');
});

test('smoke: sub-exports resolve', async t => {
  const paths = await import('dynamodb-toolkit/paths');
  t.ok(paths, 'dynamodb-toolkit/paths resolves');

  const expressions = await import('dynamodb-toolkit/expressions');
  t.ok(expressions, 'dynamodb-toolkit/expressions resolves');

  const batch = await import('dynamodb-toolkit/batch');
  t.ok(batch, 'dynamodb-toolkit/batch resolves');

  const mass = await import('dynamodb-toolkit/mass');
  t.ok(mass, 'dynamodb-toolkit/mass resolves');

  const restCore = await import('dynamodb-toolkit/rest-core');
  t.ok(restCore, 'dynamodb-toolkit/rest-core resolves');

  const handler = await import('dynamodb-toolkit/handler');
  t.ok(handler, 'dynamodb-toolkit/handler resolves');
});
