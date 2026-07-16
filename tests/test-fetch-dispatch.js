// Dispatch & error behavior: unknown / off-mount routes honor onMiss (or
// terminal 404), known shapes with wrong methods return 405, thrown adapter
// errors map through the policy.

import test from 'tape-six';

import {createFetchAdapter} from 'dynamodb-toolkit/fetch';

import {makeMockAdapter} from './helpers/mock-adapter.js';
import {withFetchHandler} from './helpers/with-fetch-handler.js';

test('unknown route shape → default terminal 404 when no onMiss', async t => {
  const adapter = makeMockAdapter();
  await withFetchHandler(createFetchAdapter(adapter), async client => {
    // Three path segments → route.kind === 'unknown' in matchRoute.
    const res = await client('/a/b/c');
    t.equal(res.status, 404);
    t.equal(adapter.calls.length, 0, 'adapter was not invoked');
  });
});

test('unknown route → onMiss returning Response is returned verbatim', async t => {
  const adapter = makeMockAdapter();
  const onMiss = request =>
    new Response(JSON.stringify({marker: 'miss', path: new URL(request.url).pathname}), {
      status: 418,
      headers: {'content-type': 'application/json'}
    });
  await withFetchHandler(createFetchAdapter(adapter, {onMiss}), async client => {
    const res = await client('/a/b/c');
    t.equal(res.status, 418);
    const body = await res.json();
    t.equal(body.marker, 'miss');
    t.equal(body.path, '/a/b/c');
  });
});

test('unknown route → onMiss returning null widens handler to null', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {onMiss: () => null});
  const res = await handler(new Request('http://local.test/x/y/z'));
  t.equal(res, null, 'handler yields null for router composition');
  t.equal(adapter.calls.length, 0);
});

test('unknown route → onMiss returning undefined falls back to 404', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {onMiss: () => undefined});
  const res = await handler(new Request('http://local.test/x/y/z'));
  t.ok(res instanceof Response, 'falls back to default 404 Response');
  t.equal(res.status, 404);
});

test('mountPath — off-mount path is a miss', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {mountPath: '/planets'});
  const res = await handler(new Request('http://local.test/users/alice'));
  t.equal(res.status, 404, 'default miss when request is outside mount');
  t.equal(adapter.calls.length, 0);
});

test('mountPath — on-mount path dispatches against stripped pathname', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {mountPath: '/planets'});
  const res = await handler(new Request('http://local.test/planets/earth'));
  t.equal(res.status, 200);
  const body = await res.json();
  t.deepEqual(body, {name: 'earth', v: 1});
});

test('mountPath — root of mount maps to adapter root', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {mountPath: '/planets'});
  const res = await handler(new Request('http://local.test/planets'));
  t.equal(res.status, 200, 'GET /planets → adapter root getList');
  t.equal(adapter.calls[0].fn, 'getList');
});

test('pagination links preserve mountPath in URL', async t => {
  const adapter = makeMockAdapter({
    async getList(opts) {
      return {data: [{name: 'a'}], offset: opts.offset, limit: opts.limit, total: 20};
    }
  });
  const handler = createFetchAdapter(adapter, {mountPath: '/planets'});
  const res = await handler(new Request('http://local.test/planets/?offset=5&limit=5'));
  const body = await res.json();
  t.ok(body.links.next.startsWith('/planets/'), 'next link keeps /planets prefix');
});

test('known route shape with wrong method → 405', async t => {
  const adapter = makeMockAdapter();
  await withFetchHandler(createFetchAdapter(adapter), async client => {
    const res = await client('/earth', {method: 'POST'});
    t.equal(res.status, 405);
    const body = await res.json();
    t.equal(body.code, 'MethodNotAllowed');
    t.equal(adapter.calls.length, 0);
  });
});

test('unknown collection method (e.g. PUT /-frob) → 405', async t => {
  const adapter = makeMockAdapter();
  await withFetchHandler(createFetchAdapter(adapter), async client => {
    const res = await client('/-frob', {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: '{}'
    });
    t.equal(res.status, 405);
  });
});

test('adapter throws ConditionalCheckFailedException → 409 via policy', async t => {
  const err = Object.assign(new Error('collision'), {name: 'ConditionalCheckFailedException'});
  const adapter = makeMockAdapter({
    async post() {
      throw err;
    }
  });
  await withFetchHandler(createFetchAdapter(adapter), async client => {
    const res = await client('/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'earth'})
    });
    t.equal(res.status, 409);
    const body = await res.json();
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
  await withFetchHandler(createFetchAdapter(adapter), async client => {
    const res = await client('/anything');
    t.equal(res.status, 422);
    const body = await res.json();
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
  await withFetchHandler(createFetchAdapter(adapter, {policy}), async client => {
    const miss = await client('/gone');
    t.equal(miss.status, 410, 'miss uses custom policy.statusCodes.miss');

    const list = await client('/');
    const body = await list.json();
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
  await withFetchHandler(createFetchAdapter(adapter, {keyFromPath}), async client => {
    await client('/tenant-1:sol-3');
    t.equal(seen[0].raw, 'tenant-1:sol-3', 'raw segment URL-decoded');
    t.deepEqual(seen[0].keyFields, [
      {name: 'pk', type: 'string'},
      {name: 'sk', type: 'string'}
    ]);
    t.deepEqual(adapter.calls[0].key, {pk: 'tenant-1', sk: 'sol-3'});
  });
});

test('exampleFromContext receives {query, body, adapter, framework, request}', async t => {
  const adapter = makeMockAdapter();
  const seen = [];
  const exampleFromContext = ({query, body, adapter: adp, framework, request}) => {
    seen.push({query, body, framework, method: request.method, pathname: new URL(request.url).pathname, adapterIsSame: adp === adapter});
    return {tenant: query.tenant || 'default'};
  };
  await withFetchHandler(createFetchAdapter(adapter, {exampleFromContext}), async client => {
    await client('/?tenant=acme&limit=5');
    t.equal(seen[0].query.tenant, 'acme');
    t.equal(seen[0].framework, 'fetch');
    t.equal(seen[0].method, 'GET');
    t.equal(seen[0].pathname, '/');
    t.equal(seen[0].body, null, 'body is null on GET /');
    t.ok(seen[0].adapterIsSame, 'adapter in options bag is the same Adapter instance');
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
  await withFetchHandler(createFetchAdapter(adapter, {exampleFromContext}), async client => {
    await client('/-clone?tenant=acme', {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'cloned'})
    });
    t.deepEqual(seen[0].body, {tag: 'cloned'});
    t.equal(seen[0].query.tenant, 'acme');
  });
});

test('mountPath with trailing slash is normalized', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {mountPath: '/planets/'});
  await withFetchHandler(handler, async client => {
    const res = await client('/planets/earth');
    t.equal(res.status, 200);
    t.deepEqual(adapter.calls[0].key, {name: 'earth'}, 'route matched under trailing-slash mount');
  });
});

test('sortableIndices resolves ?sort= to an index name', async t => {
  const adapter = makeMockAdapter();
  await withFetchHandler(createFetchAdapter(adapter, {sortableIndices: {createdAt: 'by-created-index'}}), async client => {
    await client('/?sort=createdAt');
    t.equal(adapter.calls[0].index, 'by-created-index');
  });
});

test('sortableIndices: ?sort=-name sets descending', async t => {
  const adapter = makeMockAdapter();
  await withFetchHandler(createFetchAdapter(adapter, {sortableIndices: {name: 'by-name-index'}}), async client => {
    await client('/?sort=-name');
    t.equal(adapter.calls[0].opts.descending, true);
  });
});
