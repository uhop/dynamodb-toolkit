import test from 'tape-six';

import {createLambdaAdapter} from 'dynamodb-toolkit/lambda';

import {makeMockAdapter} from './helpers/mock-adapter.js';
import {makeClient} from './helpers/with-lambda-handler.js';

test('smoke: package loads + factory returns a Lambda handler', t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  t.equal(typeof handler, 'function', 'handler is a function');
  t.equal(handler.length, 2, 'handler takes (event, context)');
});

test('smoke: options object is optional', t => {
  const adapter = makeMockAdapter();
  t.doesNotThrow(() => createLambdaAdapter(adapter), 'accepts no options');
});

test('smoke: handler returns a Lambda result envelope', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  const client = makeClient(handler);
  const res = await client('/');
  t.equal(typeof res, 'object', 'returns an object');
  t.equal(res.statusCode, 200, 'root GET responds 200 from mock getList');
  t.equal(typeof res.body, 'string', 'body is a string');
});
