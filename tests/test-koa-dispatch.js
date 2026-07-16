// Dispatch & error behavior: unknown routes hand back to next(), known shapes
// with wrong methods return 405, thrown adapter errors map through the policy.

import test from 'tape-six';

import {createKoaAdapter} from 'dynamodb-toolkit/koa';

import {makeMockAdapter} from './helpers/mock-adapter-koa.js';
import {withKoaServer} from './helpers/with-koa-server.js';

test('unknown route shape → next() fires; downstream middleware responds', async t => {
  const adapter = makeMockAdapter();
  let downstreamHit = false;

  const mounted = createKoaAdapter(adapter);
  const composed = async (ctx, next) => {
    await mounted(ctx, async () => {
      downstreamHit = true;
      ctx.status = 200;
      ctx.body = {marker: 'downstream'};
      await next();
    });
  };

  await withKoaServer(composed, async base => {
    // Three path segments → route.kind === 'unknown' in matchRoute.
    const res = await fetch(`${base}/a/b/c`);
    t.equal(res.status, 200);
    const body = await res.json();
    t.equal(body.marker, 'downstream');
    t.ok(downstreamHit, 'next() was called');
    t.equal(adapter.calls.length, 0, 'adapter was not invoked');
  });
});

test('known route shape with wrong method → 405', async t => {
  const adapter = makeMockAdapter();
  await withKoaServer(createKoaAdapter(adapter), async base => {
    const res = await fetch(`${base}/earth`, {method: 'POST'});
    t.equal(res.status, 405);
    const body = await res.json();
    t.equal(body.code, 'MethodNotAllowed');
    t.equal(adapter.calls.length, 0);
  });
});

test('unknown collection method (e.g. PUT /-frob) → 405', async t => {
  const adapter = makeMockAdapter();
  await withKoaServer(createKoaAdapter(adapter), async base => {
    const res = await fetch(`${base}/-frob`, {
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
  await withKoaServer(createKoaAdapter(adapter), async base => {
    const res = await fetch(`${base}/`, {
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
  await withKoaServer(createKoaAdapter(adapter), async base => {
    const res = await fetch(`${base}/anything`);
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
  await withKoaServer(createKoaAdapter(adapter, {policy}), async base => {
    const miss = await fetch(`${base}/gone`);
    t.equal(miss.status, 410, 'miss uses custom policy.statusCodes.miss');

    const list = await fetch(`${base}/`);
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
  await withKoaServer(createKoaAdapter(adapter, {keyFromPath}), async base => {
    await fetch(`${base}/tenant-1:sol-3`);
    t.equal(seen[0].raw, 'tenant-1:sol-3', 'raw segment URL-decoded');
    t.deepEqual(seen[0].keyFields, [
      {name: 'pk', type: 'string'},
      {name: 'sk', type: 'string'}
    ]);
    t.deepEqual(adapter.calls[0].key, {pk: 'tenant-1', sk: 'sol-3'});
  });
});

test('exampleFromContext receives {query, body, adapter, framework, ctx}', async t => {
  const adapter = makeMockAdapter();
  const seen = [];
  const exampleFromContext = ({query, body, adapter: adp, framework, ctx}) => {
    seen.push({query, body, framework, method: ctx.method, path: ctx.path, adapterIsSame: adp === adapter});
    return {tenant: query.tenant || 'default'};
  };
  await withKoaServer(createKoaAdapter(adapter, {exampleFromContext}), async base => {
    await fetch(`${base}/?tenant=acme&limit=5`);
    t.equal(seen[0].query.tenant, 'acme');
    t.equal(seen[0].framework, 'koa');
    t.equal(seen[0].method, 'GET');
    t.equal(seen[0].path, '/');
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
  await withKoaServer(createKoaAdapter(adapter, {exampleFromContext}), async base => {
    await fetch(`${base}/-clone?tenant=acme`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'cloned'})
    });
    t.deepEqual(seen[0].body, {tag: 'cloned'}, 'overlay body passes through');
    t.equal(seen[0].query.tenant, 'acme');
  });
});

test('sortableIndices resolves ?sort= to an index name', async t => {
  const adapter = makeMockAdapter();
  await withKoaServer(createKoaAdapter(adapter, {sortableIndices: {createdAt: 'by-created-index'}}), async base => {
    await fetch(`${base}/?sort=createdAt`);
    t.equal(adapter.calls[0].index, 'by-created-index');
  });
});

test('sortableIndices: ?sort=-name sets descending', async t => {
  const adapter = makeMockAdapter();
  await withKoaServer(createKoaAdapter(adapter, {sortableIndices: {name: 'by-name-index'}}), async base => {
    await fetch(`${base}/?sort=-name`);
    t.equal(adapter.calls[0].opts.descending, true);
  });
});
