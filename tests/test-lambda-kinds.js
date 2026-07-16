// Event-shape coverage: exercise every supported event kind on a handful of
// representative routes, and verify the response envelope matches the trigger
// (single-value `headers` vs. `multiValueHeaders`). The main per-route
// coverage lives in test-routes.js (v2); this file is the multi-shape sweep.

import test from 'tape-six';

import {createLambdaAdapter} from 'dynamodb-toolkit/lambda';

import {makeMockAdapter} from './helpers/mock-adapter.js';
import {makeClient, readJsonResult} from './helpers/with-lambda-handler.js';

const KINDS = ['v1', 'v2', 'alb'];

for (const kind of KINDS) {
  test(`[${kind}] GET / returns envelope`, async t => {
    const adapter = makeMockAdapter();
    const client = makeClient(createLambdaAdapter(adapter), kind);
    const res = await client('/?offset=0&limit=2');
    t.equal(res.statusCode, 200);
    const body = readJsonResult(res);
    t.deepEqual(body.data, [{name: 'earth'}, {name: 'mars'}], 'envelope data');
    t.equal(adapter.calls[0].fn, 'getList');
    t.equal(typeof res.headers, 'object', 'single-value headers on by default');
    t.notOk(res.multiValueHeaders, 'no multiValueHeaders when event is single-value');
  });

  test(`[${kind}] POST / creates via adapter.post`, async t => {
    const adapter = makeMockAdapter();
    const client = makeClient(createLambdaAdapter(adapter), kind);
    const res = await client('/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'pluto'})
    });
    t.equal(res.statusCode, 204);
    t.deepEqual(adapter.calls[0].item, {name: 'pluto'});
  });

  test(`[${kind}] GET /:key returns item`, async t => {
    const adapter = makeMockAdapter();
    const client = makeClient(createLambdaAdapter(adapter), kind);
    const res = await client('/earth');
    t.equal(res.statusCode, 200);
    const body = readJsonResult(res);
    t.deepEqual(body, {name: 'earth', v: 1});
  });

  test(`[${kind}] unknown route → 404`, async t => {
    const adapter = makeMockAdapter();
    const client = makeClient(createLambdaAdapter(adapter), kind);
    const res = await client('/a/b/c');
    t.equal(res.statusCode, 404);
  });

  test(`[${kind}] pagination link path preserves trigger's path shape`, async t => {
    const adapter = makeMockAdapter({
      async getList(opts) {
        return {data: [{name: 'a'}], offset: opts.offset, limit: opts.limit, total: 20};
      }
    });
    const client = makeClient(createLambdaAdapter(adapter, {mountPath: '/planets'}), kind);
    const res = await client('/planets?offset=5&limit=5');
    const body = readJsonResult(res);
    t.ok(body.links.next.startsWith('/planets'), 'next link keeps mountPath');
  });
}

// Multi-value header mirroring — ALB with multi-value mode enabled. That
// trigger delivers only `multiValueHeaders` (headers null-stamped) and strictly
// requires the response in the same shape. API Gateway v1 always delivers BOTH
// forms and accepts either response shape; we use single-value there.

test('[alb-multi] response mirrors multiValueHeaders', async t => {
  const adapter = makeMockAdapter();
  const client = makeClient(createLambdaAdapter(adapter), 'alb-multi');
  const res = await client('/');
  t.equal(res.statusCode, 200);
  t.ok(res.multiValueHeaders, 'multiValueHeaders present on response');
  t.deepEqual(res.multiValueHeaders['content-type'], ['application/json; charset=utf-8']);
  t.notOk(res.headers, 'single-value headers not emitted in multi-value mode');
});

test('[v1] API Gateway v1 always receives both shapes, responds single-value', async t => {
  const adapter = makeMockAdapter();
  const client = makeClient(createLambdaAdapter(adapter), 'v1');
  const res = await client('/');
  t.equal(res.statusCode, 200);
  t.ok(res.headers, 'single-value headers emitted for v1 (accepted by AWS regardless of integration mode)');
  t.notOk(res.multiValueHeaders, 'multi-value not force-emitted for v1');
});
