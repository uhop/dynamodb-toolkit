import test from 'tape-six';

import {createExpressAdapter} from 'dynamodb-toolkit/express';

import {makeMockAdapter} from './helpers/mock-adapter-express.js';

test('smoke: package loads + factory returns middleware', t => {
  const adapter = makeMockAdapter();
  const mw = createExpressAdapter(adapter);
  t.equal(typeof mw, 'function', 'middleware is a function');
  t.equal(mw.length, 3, 'middleware takes (req, res, next)');
});

test('smoke: options object is optional', t => {
  const adapter = makeMockAdapter();
  t.doesNotThrow(() => createExpressAdapter(adapter), 'accepts no options');
});
