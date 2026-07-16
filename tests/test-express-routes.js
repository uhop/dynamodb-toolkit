// End-to-end route coverage: spin up a real Express app with
// createExpressAdapter mounted at `/`, exercise every route via fetch, assert
// wire shape + that the mock Adapter received the expected method calls.

import test from 'tape-six';

import {createExpressAdapter} from 'dynamodb-toolkit/express';

import {makeMockAdapter} from './helpers/mock-adapter-express.js';
import {withExpressServer} from './helpers/with-express-server.js';

test('GET / — envelope + paging links from mock getList', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/?offset=0&limit=2`);
    t.equal(res.status, 200);
    const body = await res.json();
    t.deepEqual(body.data, [{name: 'earth'}, {name: 'mars'}]);
    t.equal(body.offset, 0);
    t.equal(body.limit, 2);
    t.equal(body.total, 2);
    t.equal(adapter.calls[0].fn, 'getList');
    t.equal(adapter.calls[0].opts.offset, 0);
    t.equal(adapter.calls[0].opts.limit, 2);
  });
});

test('GET / — pagination links appear when total > limit', async t => {
  const adapter = makeMockAdapter({
    async getList(opts) {
      return {data: [{name: 'a'}], offset: opts.offset, limit: opts.limit, total: 20};
    }
  });
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/?offset=5&limit=5`);
    const body = await res.json();
    t.ok(body.links, 'links envelope key present');
    t.ok(body.links.prev, 'prev link present');
    t.ok(body.links.next, 'next link present');
    t.ok(body.links.next.includes('offset=10'), 'next advances offset');
  });
});

test('POST / — creates via adapter.post', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'pluto', mass: 0.0146})
    });
    t.equal(res.status, 204);
    t.equal(adapter.calls[0].fn, 'post');
    t.deepEqual(adapter.calls[0].item, {name: 'pluto', mass: 0.0146});
  });
});

test('DELETE / — deleteListByParams with built params', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/?limit=10`, {method: 'DELETE'});
    const body = await res.json();
    t.equal(res.status, 200);
    t.equal(body.processed, 5);
    t.equal(adapter.calls[0].fn, '_buildListParams');
    t.equal(adapter.calls[1].fn, 'deleteListByParams');
  });
});

test('GET /-by-names — returns items array', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-by-names?names=earth,mars`);
    const body = await res.json();
    t.equal(res.status, 200);
    t.deepEqual(body, [
      {name: 'earth', v: 1},
      {name: 'mars', v: 1}
    ]);
    const call = adapter.calls[0];
    t.equal(call.fn, 'getByKeys');
    t.deepEqual(call.keys, [{name: 'earth'}, {name: 'mars'}], 'keys built via default keyFromPath');
  });
});

test('DELETE /-by-names — names from query', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-by-names?names=a,b,c`, {method: 'DELETE'});
    const body = await res.json();
    t.equal(body.processed, 3);
    t.equal(adapter.calls[0].fn, 'deleteByKeys');
  });
});

test('DELETE /-by-names — falls back to array body when no query', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-by-names`, {
      method: 'DELETE',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(['x', 'y'])
    });
    const body = await res.json();
    t.equal(body.processed, 2);
    const call = adapter.calls[0];
    t.deepEqual(call.keys, [{name: 'x'}, {name: 'y'}]);
  });
});

test('PUT /-load — bulk putItems', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-load`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify([{name: 'a'}, {name: 'b'}])
    });
    const body = await res.json();
    t.equal(body.processed, 2);
  });
});

test('PUT /-load — 400 when body is not an array', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-load`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({nope: true})
    });
    t.equal(res.status, 400);
    const body = await res.json();
    t.equal(body.code, 'BadLoadBody');
  });
});

test('PUT /-clone — cloneListByParams with overlay', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-clone`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'copy'})
    });
    const body = await res.json();
    t.equal(body.processed, 3);
    t.equal(adapter.calls[1].fn, 'cloneListByParams');
  });
});

test('PUT /-move — moveListByParams with overlay', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-move`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'gone'})
    });
    const body = await res.json();
    t.equal(body.processed, 3);
    t.equal(adapter.calls[1].fn, 'moveListByParams');
  });
});

test('PUT /-clone-by-names — names + overlay split', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-clone-by-names?names=a,b`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'copied'})
    });
    const body = await res.json();
    t.equal(body.processed, 2);
    const call = adapter.calls[0];
    t.equal(call.fn, 'cloneByKeys');
    t.equal(typeof call.mapFn, 'function');
    t.deepEqual(call.mapFn({name: 'a'}), {name: 'a', tag: 'copied'});
  });
});

test('PUT /-move-by-names — names + overlay split', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/-move-by-names?names=a,b`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'moved'})
    });
    const body = await res.json();
    t.equal(body.processed, 2);
    t.equal(adapter.calls[0].fn, 'moveByKeys');
  });
});

test('GET /:key — returns item', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/earth`);
    const body = await res.json();
    t.equal(res.status, 200);
    t.deepEqual(body, {name: 'earth', v: 1});
    t.deepEqual(adapter.calls[0].key, {name: 'earth'});
  });
});

test('GET /:key — miss returns policy.statusCodes.miss', async t => {
  const adapter = makeMockAdapter({
    async getByKey() {
      return undefined;
    }
  });
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/nowhere`);
    t.equal(res.status, 404);
  });
});

test('PUT /:key — merges URL key into body, force via ?force', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/earth?force=true`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({mass: 5.97})
    });
    t.equal(res.status, 204);
    const call = adapter.calls[0];
    t.deepEqual(call.item, {mass: 5.97, name: 'earth'});
    t.equal(call.opts.force, true);
  });
});

test('PATCH /:key — parsePatch splits body via metaPrefix', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/earth`, {
      method: 'PATCH',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({mass: 5.97, _delete: ['retired']})
    });
    t.equal(res.status, 204);
    const call = adapter.calls[0];
    t.deepEqual(call.patch, {mass: 5.97});
    t.deepEqual(call.opts.delete, ['retired']);
  });
});

test('DELETE /:key — calls adapter.delete', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/earth`, {method: 'DELETE'});
    t.equal(res.status, 204);
    t.deepEqual(adapter.calls[0].key, {name: 'earth'});
  });
});

test('PUT /:key/-clone — single-item clone with overlay', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/earth/-clone`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'copy'})
    });
    t.equal(res.status, 204);
    t.equal(adapter.calls[0].fn, 'clone');
  });
});

test('PUT /:key/-move — single-item move with overlay', async t => {
  const adapter = makeMockAdapter();
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/earth/-move`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({tag: 'moved'})
    });
    t.equal(res.status, 204);
    t.equal(adapter.calls[0].fn, 'move');
  });
});

test('PUT /:key/-clone — miss returns policy.statusCodes.miss', async t => {
  const adapter = makeMockAdapter({
    async clone() {
      return undefined;
    }
  });
  await withExpressServer(createExpressAdapter(adapter), async base => {
    const res = await fetch(`${base}/nowhere/-clone`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({})
    });
    t.equal(res.status, 404);
  });
});
