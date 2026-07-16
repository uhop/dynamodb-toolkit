import test from 'tape-six';

import {createFetchAdapter} from 'dynamodb-toolkit/fetch';

import {makeMockAdapter} from './helpers/mock-adapter-fetch.js';

test('smoke: package loads + factory returns a fetch handler', t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter);
  t.equal(typeof handler, 'function', 'handler is a function');
  t.equal(handler.length, 1, 'handler takes a single (request) arg');
});

test('smoke: options object is optional', t => {
  const adapter = makeMockAdapter();
  t.doesNotThrow(() => createFetchAdapter(adapter), 'accepts no options');
});

test('smoke: handler returns a Response', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter);
  const res = await handler(new Request('http://local.test/'));
  t.ok(res instanceof Response, 'returns a Response instance');
  t.equal(res.status, 200, 'root GET responds 200 from mock getList');
});
