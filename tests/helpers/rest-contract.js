// Shared wire-contract suite for the framework adapters. Every adapter serves
// the same route pack with the same envelope, status codes, and adapter-method
// dispatch — these cases assert exactly that, parameterized by a normalized
// client so each adapter's translation layer is exercised through its own I/O.
//
// Harness contract: `withClient(mockAdapter, fn)` builds the framework adapter
// around the mock and invokes `fn(call)`, where
// `call(pathAndQuery, init?) → Promise<{status, json()}>` — `init` is a
// fetch-style `{method, headers, body}`; `json()` resolves to the parsed body
// or `null` when empty. Adapter-specific behavior (miss fall-through, body
// readers, event shapes) stays in the per-adapter suites.

import test from 'tape-six';
import {encodeCursor} from 'dynamodb-toolkit/mass';

import {makeMockAdapter} from './mock-adapter.js';

// Normalizer for harnesses that produce a web `Response` (express, koa, fetch).
export const wrapWebResponse = res => {
  let textPromise;
  const text = () => (textPromise ??= res.text());
  return {
    status: res.status,
    text,
    json: async () => {
      const body = await text();
      return body ? JSON.parse(body) : null;
    }
  };
};

const JSON_INIT = body => ({headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});

export const runRestContract = (label, withClient) => {
  test(`${label}: GET / — envelope + paging links from mock getList`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/?offset=0&limit=2');
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

  test(`${label}: GET / — pagination links appear when total > limit`, async t => {
    const adapter = makeMockAdapter({
      async getList(opts) {
        return {data: [{name: 'a'}], offset: opts.offset, limit: opts.limit, total: 20};
      }
    });
    await withClient(adapter, async call => {
      const res = await call('/?offset=5&limit=5');
      const body = await res.json();
      t.ok(body.links, 'links envelope key present');
      t.ok(body.links.prev, 'prev link present');
      t.ok(body.links.next, 'next link present');
      t.ok(body.links.next.includes('offset=10'), 'next advances offset');
    });
  });

  test(`${label}: GET /?cursor — cursor-mode envelope`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/?cursor&limit=2');
      t.equal(res.status, 200);
      const body = await res.json();
      t.deepEqual(body.data, [{name: 'earth'}, {name: 'mars'}]);
      t.equal(body.limit, 2);
      t.equal(body.cursor, 'next-token');
      t.notOk('offset' in body, 'no offset in cursor mode');
      t.notOk('total' in body, 'no total in cursor mode');
      t.equal(adapter.calls[0].fn, 'getPage');
    });
  });

  test(`${label}: GET /?cursor=<token> — token passed to getPage`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const token = encodeCursor({LastEvaluatedKey: {name: 'mars'}});
      const res = await call(`/?cursor=${token}`);
      t.equal(res.status, 200);
      const body = await res.json();
      t.notOk('cursor' in body, 'exhausted listing omits cursor');
      t.equal(adapter.calls[0].opts.cursor, token);
    });
  });

  test(`${label}: GET /?format=jsonl — NDJSON lines, no envelope`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/?format=jsonl&limit=2');
      t.equal(res.status, 200);
      const text = await res.text();
      t.equal(text, '{"name":"earth"}\n{"name":"mars"}\n');
      t.equal(adapter.calls[0].opts.needTotal, false, 'COUNT pass skipped in jsonl mode');
    });
  });

  test(`${label}: GET /?format=bogus — 400 BadFormat`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/?format=bogus');
      t.equal(res.status, 400);
      const body = await res.json();
      t.equal(body.code, 'BadFormat');
    });
  });

  test(`${label}: GET /?cursor=garbage — 400 BadCursor`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/?cursor=%21%21%21not-a-cursor');
      t.equal(res.status, 400);
      const body = await res.json();
      t.equal(body.code, 'BadCursor');
      t.equal(adapter.calls.length, 0, 'adapter untouched');
    });
  });

  test(`${label}: POST / — creates via adapter.post`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/', {method: 'POST', ...JSON_INIT({name: 'pluto', mass: 0.0146})});
      t.equal(res.status, 204);
      t.equal(adapter.calls[0].fn, 'post');
      t.deepEqual(adapter.calls[0].item, {name: 'pluto', mass: 0.0146});
    });
  });

  test(`${label}: DELETE / — deleteListByParams with built params`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/?limit=10&confirm=true', {method: 'DELETE'});
      const body = await res.json();
      t.equal(res.status, 200);
      t.equal(body.processed, 5);
      t.equal(adapter.calls[0].fn, '_buildListParams');
      t.equal(adapter.calls[1].fn, 'deleteListByParams');
    });
  });

  test(`${label}: DELETE / — unscoped without confirm is rejected`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/', {method: 'DELETE'});
      t.equal(res.status, 400);
      const body = await res.json();
      t.equal(body.code, 'UnscopedMassDelete');
      t.equal(adapter.calls.length, 0, 'adapter untouched');
    });
  });

  test(`${label}: DELETE / — filter scope allows delete without confirm`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/?eq-name=earth', {method: 'DELETE'});
      t.equal(res.status, 200);
      t.equal(adapter.calls[1].fn, 'deleteListByParams');
    });
  });

  test(`${label}: DELETE / — mass wire options plumbed + rich result surfaced`, async t => {
    let seenOpts;
    const adapter = makeMockAdapter({
      async deleteListByParams(_params, opts) {
        seenOpts = opts;
        return {processed: 5, skipped: 1, failed: [{key: {name: 'x'}, reason: 'Unknown'}], conflicts: [], cursor: 'abc'};
      }
    });
    await withClient(adapter, async call => {
      const resume = encodeCursor({LastEvaluatedKey: {name: 'm'}});
      const res = await call(`/?eq-name=earth&max-items=7&resume=${resume}`, {method: 'DELETE'});
      t.equal(res.status, 200);
      const body = await res.json();
      t.equal(body.processed, 5);
      t.equal(body.skipped, 1);
      t.equal(body.failed.length, 1);
      t.equal(body.cursor, 'abc');
      t.notOk('conflicts' in body, 'empty conflicts omitted');
      t.equal(seenOpts.maxItems, 7);
      t.equal(seenOpts.resumeToken, resume);
    });
  });

  test(`${label}: DELETE / — malformed resume token is a 400`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/?eq-name=earth&resume=%21%21%21not-a-cursor', {method: 'DELETE'});
      t.equal(res.status, 400);
      const body = await res.json();
      t.equal(body.code, 'BadCursor');
    });
  });

  test(`${label}: GET /-by-names — returns items array`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-by-names?names=earth,mars');
      const body = await res.json();
      t.equal(res.status, 200);
      t.deepEqual(body, [
        {name: 'earth', v: 1},
        {name: 'mars', v: 1}
      ]);
      const c = adapter.calls[0];
      t.equal(c.fn, 'getByKeys');
      t.deepEqual(c.keys, [{name: 'earth'}, {name: 'mars'}], 'keys built via default keyFromPath');
    });
  });

  test(`${label}: DELETE /-by-names — names from query`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-by-names?names=a,b,c', {method: 'DELETE'});
      const body = await res.json();
      t.equal(body.processed, 3);
      t.equal(adapter.calls[0].fn, 'deleteByKeys');
    });
  });

  test(`${label}: DELETE /-by-names — falls back to array body when no query`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-by-names', {method: 'DELETE', ...JSON_INIT(['x', 'y'])});
      const body = await res.json();
      t.equal(body.processed, 2);
      const c = adapter.calls[0];
      t.deepEqual(c.keys, [{name: 'x'}, {name: 'y'}]);
    });
  });

  test(`${label}: GET /-by-keys — keys param + route alias`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-by-keys?keys=earth,mars');
      const body = await res.json();
      t.equal(res.status, 200);
      t.deepEqual(body, [
        {name: 'earth', v: 1},
        {name: 'mars', v: 1}
      ]);
      t.deepEqual(adapter.calls[0].keys, [{name: 'earth'}, {name: 'mars'}]);
    });
  });

  test(`${label}: PUT /-clone-by-keys + /-move-by-keys — aliases dispatch`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      await call('/-clone-by-keys?keys=a', {method: 'PUT', ...JSON_INIT({})});
      await call('/-move-by-keys?keys=b', {method: 'PUT', ...JSON_INIT({})});
      t.equal(adapter.calls[0].fn, 'cloneByKeys');
      t.equal(adapter.calls[1].fn, 'moveByKeys');
    });
  });

  test(`${label}: PUT /-load — bulk putItems`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-load', {method: 'PUT', ...JSON_INIT([{name: 'a'}, {name: 'b'}])});
      const body = await res.json();
      t.equal(body.processed, 2);
    });
  });

  test(`${label}: PUT /-load — 400 when body is not an array`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-load', {method: 'PUT', ...JSON_INIT({nope: true})});
      t.equal(res.status, 400);
      const body = await res.json();
      t.equal(body.code, 'BadLoadBody');
    });
  });

  test(`${label}: PUT /-clone — cloneListByParams with overlay`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-clone', {method: 'PUT', ...JSON_INIT({tag: 'copy'})});
      const body = await res.json();
      t.equal(body.processed, 3);
      t.equal(adapter.calls[1].fn, 'cloneListByParams');
    });
  });

  test(`${label}: PUT /-move — moveListByParams with overlay`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-move', {method: 'PUT', ...JSON_INIT({tag: 'gone'})});
      const body = await res.json();
      t.equal(body.processed, 3);
      t.equal(adapter.calls[1].fn, 'moveListByParams');
    });
  });

  test(`${label}: PUT /-clone-by-names — names + overlay split`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-clone-by-names?names=a,b', {method: 'PUT', ...JSON_INIT({tag: 'copied'})});
      const body = await res.json();
      t.equal(body.processed, 2);
      const c = adapter.calls[0];
      t.equal(c.fn, 'cloneByKeys');
      t.equal(typeof c.mapFn, 'function');
      t.deepEqual(c.mapFn({name: 'a'}), {name: 'a', tag: 'copied'});
    });
  });

  test(`${label}: PUT /-move-by-names — names + overlay split`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/-move-by-names?names=a,b', {method: 'PUT', ...JSON_INIT({tag: 'moved'})});
      const body = await res.json();
      t.equal(body.processed, 2);
      t.equal(adapter.calls[0].fn, 'moveByKeys');
    });
  });

  test(`${label}: GET /:key — returns item`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/earth');
      const body = await res.json();
      t.equal(res.status, 200);
      t.deepEqual(body, {name: 'earth', v: 1});
      t.deepEqual(adapter.calls[0].key, {name: 'earth'});
    });
  });

  test(`${label}: GET /:key — miss returns policy.statusCodes.miss`, async t => {
    const adapter = makeMockAdapter({
      async getByKey() {
        return undefined;
      }
    });
    await withClient(adapter, async call => {
      const res = await call('/nowhere');
      t.equal(res.status, 404);
    });
  });

  test(`${label}: PUT /:key — merges URL key into body, force via ?force`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/earth?force=true', {method: 'PUT', ...JSON_INIT({mass: 5.97})});
      t.equal(res.status, 204);
      const c = adapter.calls[0];
      t.deepEqual(c.item, {mass: 5.97, name: 'earth'});
      t.equal(c.opts.force, true);
    });
  });

  test(`${label}: PATCH /:key — parsePatch splits body via metaPrefix`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/earth', {method: 'PATCH', ...JSON_INIT({mass: 5.97, _delete: ['retired']})});
      t.equal(res.status, 204);
      const c = adapter.calls[0];
      t.deepEqual(c.patch, {mass: 5.97});
      t.deepEqual(c.opts.delete, ['retired']);
    });
  });

  test(`${label}: DELETE /:key — calls adapter.delete`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/earth', {method: 'DELETE'});
      t.equal(res.status, 204);
      t.deepEqual(adapter.calls[0].key, {name: 'earth'});
    });
  });

  test(`${label}: PUT /:key/-clone — single-item clone with overlay`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/earth/-clone', {method: 'PUT', ...JSON_INIT({tag: 'copy'})});
      t.equal(res.status, 204);
      t.equal(adapter.calls[0].fn, 'clone');
    });
  });

  test(`${label}: PUT /:key/-move — single-item move with overlay`, async t => {
    const adapter = makeMockAdapter();
    await withClient(adapter, async call => {
      const res = await call('/earth/-move', {method: 'PUT', ...JSON_INIT({tag: 'moved'})});
      t.equal(res.status, 204);
      t.equal(adapter.calls[0].fn, 'move');
    });
  });

  test(`${label}: PUT /:key/-clone — miss returns policy.statusCodes.miss`, async t => {
    const adapter = makeMockAdapter({
      async clone() {
        return undefined;
      }
    });
    await withClient(adapter, async call => {
      const res = await call('/nowhere/-clone', {method: 'PUT', ...JSON_INIT({})});
      t.equal(res.status, 404);
    });
  });
};
