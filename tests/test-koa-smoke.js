import test from 'tape-six';

import {createKoaAdapter} from 'dynamodb-toolkit/koa';

import {makeMockAdapter} from './helpers/mock-adapter.js';

test('smoke: package loads + factory returns middleware', t => {
  const adapter = makeMockAdapter();
  const mw = createKoaAdapter(adapter);
  t.equal(typeof mw, 'function', 'middleware is a function');
  t.equal(mw.length, 2, 'middleware takes (ctx, next)');
});

test('smoke: options object is optional', t => {
  const adapter = makeMockAdapter();
  t.doesNotThrow(() => createKoaAdapter(adapter), 'accepts no options');
});
