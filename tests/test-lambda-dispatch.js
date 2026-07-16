// Dispatch & policy behavior: unknown / off-mount routes return 404, known
// shapes with wrong methods return 405, thrown adapter errors map through the
// policy, exampleFromContext receives event + context, cookies flatten on v2,
// mountPath strips for adapter matching while pagination keeps the full path.

import test from 'tape-six';

import {createLambdaAdapter} from 'dynamodb-toolkit/lambda';

import {makeMockAdapter} from './helpers/mock-adapter.js';
import {withLambdaHandler, makeClient, readJsonResult, makeV2Event, makeContext} from './helpers/with-lambda-handler.js';

test('unknown route shape → 404', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    // Three path segments → route.kind === 'unknown' in matchRoute.
    const res = await client('/a/b/c');
    t.equal(res.statusCode, 404);
    t.equal(adapter.calls.length, 0, 'adapter was not invoked');
  });
});

test('mountPath — off-mount path is a 404', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter, {mountPath: '/planets'});
  const client = makeClient(handler);
  const res = await client('/users/alice');
  t.equal(res.statusCode, 404, 'default miss when request is outside mount');
  t.equal(adapter.calls.length, 0);
});

test('mountPath — on-mount path dispatches against stripped pathname', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter, {mountPath: '/planets'});
  const client = makeClient(handler);
  const res = await client('/planets/earth');
  t.equal(res.statusCode, 200);
  const body = readJsonResult(res);
  t.deepEqual(body, {name: 'earth', v: 1});
});

test('mountPath — root of mount maps to adapter root', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter, {mountPath: '/planets'});
  const client = makeClient(handler);
  const res = await client('/planets');
  t.equal(res.statusCode, 200, 'GET /planets → adapter root getList');
  t.equal(adapter.calls[0].fn, 'getList');
});

test('pagination links preserve mountPath in URL', async t => {
  const adapter = makeMockAdapter({
    async getList(opts) {
      return {data: [{name: 'a'}], offset: opts.offset, limit: opts.limit, total: 20};
    }
  });
  const handler = createLambdaAdapter(adapter, {mountPath: '/planets'});
  const client = makeClient(handler);
  const res = await client('/planets/?offset=5&limit=5');
  const body = readJsonResult(res);
  t.ok(body.links.next.startsWith('/planets/'), 'next link keeps /planets prefix');
});

test('known route shape with wrong method → 405', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    const res = await client('/earth', {method: 'POST'});
    t.equal(res.statusCode, 405);
    const body = readJsonResult(res);
    t.equal(body.code, 'MethodNotAllowed');
    t.equal(adapter.calls.length, 0);
  });
});

test('unknown collection method (e.g. PUT /-frob) → 405', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    const res = await client('/-frob', {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: '{}'
    });
    t.equal(res.statusCode, 405);
  });
});

test('adapter throws ConditionalCheckFailedException → 409 via policy', async t => {
  const err = Object.assign(new Error('collision'), {name: 'ConditionalCheckFailedException'});
  const adapter = makeMockAdapter({
    async post() {
      throw err;
    }
  });
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    const res = await client('/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'earth'})
    });
    t.equal(res.statusCode, 409);
    const body = readJsonResult(res);
    t.equal(body.code, 'ConditionalCheckFailedException');
    t.equal(body.message, 'collision');
  });
});

test('adapter throws with explicit status — status passes through', async t => {
  const err = Object.assign(new Error('bad input'), {status: 422, code: 'BadInput'});
  const adapter = makeMockAdapter({
    async getByKey() {
      throw err;
    }
  });
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    const res = await client('/anything');
    t.equal(res.statusCode, 422);
    const body = readJsonResult(res);
    t.equal(body.code, 'BadInput');
  });
});

test('custom policy overrides envelope keys + miss status', async t => {
  const adapter = makeMockAdapter({
    async getByKey() {
      return undefined;
    }
  });
  const policy = {
    envelope: {items: 'rows', total: 'count'},
    statusCodes: {miss: 410}
  };
  await withLambdaHandler(createLambdaAdapter(adapter, {policy}), async client => {
    const miss = await client('/gone');
    t.equal(miss.statusCode, 410, 'miss uses custom policy.statusCodes.miss');

    const list = await client('/');
    const body = readJsonResult(list);
    t.ok('rows' in body, 'envelope.items remapped to rows');
    t.ok('count' in body, 'envelope.total remapped to count');
    t.notOk('data' in body, 'default items key absent');
  });
});

test('custom keyFromPath receives the raw segment + adapter', async t => {
  const adapter = makeMockAdapter({
    keyFields: [
      {name: 'pk', type: 'string'},
      {name: 'sk', type: 'string'}
    ]
  });
  const seen = [];
  const keyFromPath = (raw, adp) => {
    seen.push({raw, keyFields: adp.keyFields});
    const [pk, sk] = raw.split(':');
    return {pk, sk};
  };
  await withLambdaHandler(createLambdaAdapter(adapter, {keyFromPath}), async client => {
    await client('/tenant-1:sol-3');
    t.equal(seen[0].raw, 'tenant-1:sol-3', 'raw segment URL-decoded');
    t.deepEqual(seen[0].keyFields, [
      {name: 'pk', type: 'string'},
      {name: 'sk', type: 'string'}
    ]);
    t.deepEqual(adapter.calls[0].key, {pk: 'tenant-1', sk: 'sol-3'});
  });
});

test('exampleFromContext receives {query, body, adapter, framework, event, context}', async t => {
  const adapter = makeMockAdapter();
  const seen = [];
  const exampleFromContext = ({query, body, adapter: adp, framework, event, context}) => {
    seen.push({
      query,
      body,
      framework,
      adapterIsSame: adp === adapter,
      rawPath: event.rawPath,
      method: event.requestContext.http.method,
      awsRequestId: context.awsRequestId
    });
    return {tenant: query.tenant || 'default'};
  };
  await withLambdaHandler(createLambdaAdapter(adapter, {exampleFromContext}), async client => {
    await client('/?tenant=acme&limit=5');
    t.equal(seen[0].query.tenant, 'acme');
    t.equal(seen[0].framework, 'lambda');
    t.equal(seen[0].method, 'GET');
    t.equal(seen[0].rawPath, '/');
    t.equal(seen[0].body, null, 'body is null on GET /');
    t.ok(seen[0].adapterIsSame, 'adapter in options bag is the same Adapter instance');
    t.equal(seen[0].awsRequestId, 'test-req-id', 'context is threaded through');
    t.equal(adapter.calls[0].example.tenant, 'acme');
  });
});

test('exampleFromContext on PUT /-clone receives the parsed overlay body', async t => {
  const adapter = makeMockAdapter();
  const seen = [];
  const exampleFromContext = ({query, body}) => {
    seen.push({query, body});
    return {};
  };
  await withLambdaHandler(createLambdaAdapter(adapter, {exampleFromContext}), async client => {
    await client('/-clone?tenant=acme', {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'cloned'})
    });
    t.deepEqual(seen[0].body, {tag: 'cloned'});
    t.equal(seen[0].query.tenant, 'acme');
  });
});

test('sortableIndices resolves ?sort= to an index name', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter, {sortableIndices: {createdAt: 'by-created-index'}}), async client => {
    await client('/?sort=createdAt');
    t.equal(adapter.calls[0].index, 'by-created-index');
  });
});

test('sortableIndices: ?sort=-name sets descending', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter, {sortableIndices: {name: 'by-name-index'}}), async client => {
    await client('/?sort=-name');
    t.equal(adapter.calls[0].opts.descending, true);
  });
});

test('v2 cookies flatten into event.headers.cookie for exampleFromContext', async t => {
  const adapter = makeMockAdapter();
  let seenCookie;
  const exampleFromContext = ({event}) => {
    seenCookie = event.headers?.cookie;
    return {};
  };
  const handler = createLambdaAdapter(adapter, {exampleFromContext});
  const event = makeV2Event('GET', '/', {cookies: ['sid=abc', 'theme=dark']});
  await handler(event, makeContext());
  t.equal(seenCookie, 'sid=abc; theme=dark', 'cookies array flattened into Cookie header');
});

test('v2 cookies merge with existing cookie header', async t => {
  const adapter = makeMockAdapter();
  let seenCookie;
  const exampleFromContext = ({event}) => {
    seenCookie = event.headers?.cookie;
    return {};
  };
  const handler = createLambdaAdapter(adapter, {exampleFromContext});
  const event = makeV2Event('GET', '/', {headers: {cookie: 'pre=exists'}, cookies: ['sid=abc']});
  await handler(event, makeContext());
  t.equal(seenCookie, 'pre=exists; sid=abc', 'existing header is preserved, cookies appended');
});

test('mountPath with trailing slash is normalized', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter, {mountPath: '/planets/'});
  const event = makeV2Event('GET', '/planets/earth');
  const res = await handler(event, makeContext());
  t.equal(res.statusCode, 200, 'route matched under trailing-slash mount');
  t.deepEqual(adapter.calls[0].key, {name: 'earth'});
});
