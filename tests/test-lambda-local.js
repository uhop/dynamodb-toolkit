// Local-debug helpers: drive the Lambda handler against real HTTP traffic
// using a temporary `node:http` server (createNodeListener) and a direct
// Request/Response call (createFetchBridge).

import http from 'node:http';
import {once} from 'node:events';
import {Buffer} from 'node:buffer';

import test from 'tape-six';

import {createLambdaAdapter} from 'dynamodb-toolkit/lambda';
import {createNodeListener, createFetchBridge} from 'dynamodb-toolkit/lambda/local.js';

import {makeMockAdapter} from './helpers/mock-adapter.js';

const serveOnce = async (listener, fn) => {
  const server = http.createServer(listener);
  server.listen(0);
  await once(server, 'listening');
  const {port} = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
};

test('createNodeListener: GET / returns the mock envelope over real HTTP', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  await serveOnce(createNodeListener(handler), async base => {
    const res = await fetch(`${base}/?offset=0&limit=2`);
    t.equal(res.status, 200);
    const body = await res.json();
    t.deepEqual(body.data, [{name: 'earth'}, {name: 'mars'}]);
    t.equal(adapter.calls[0].fn, 'getList');
  });
});

test('createNodeListener: POST / round-trips JSON body', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  await serveOnce(createNodeListener(handler), async base => {
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'pluto'})
    });
    t.equal(res.status, 204);
    t.deepEqual(adapter.calls[0].item, {name: 'pluto'});
  });
});

test('createNodeListener: unknown route → 404', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  await serveOnce(createNodeListener(handler), async base => {
    const res = await fetch(`${base}/a/b/c`);
    t.equal(res.status, 404);
  });
});

test('createNodeListener: wrong method on known route → 405', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  await serveOnce(createNodeListener(handler), async base => {
    const res = await fetch(`${base}/earth`, {method: 'POST'});
    t.equal(res.status, 405);
  });
});

test('createNodeListener: v1 event shape exposes event.path to the handler', async t => {
  let seenEvent;
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter, {
    exampleFromContext: ({event}) => {
      seenEvent = event;
      return {};
    }
  });
  await serveOnce(createNodeListener(handler, {eventShape: 'v1'}), async base => {
    await fetch(`${base}/`);
    t.equal(seenEvent.httpMethod, 'GET', 'v1 event carries httpMethod');
    t.equal(seenEvent.path, '/', 'v1 event carries path');
    t.notOk(seenEvent.version, 'no v2 version marker');
  });
});

test('createNodeListener: binary body is base64-encoded before reaching the handler', async t => {
  let seen;
  const probeAdapter = makeMockAdapter();
  const probe = createLambdaAdapter(probeAdapter, {
    exampleFromContext: ({event}) => {
      seen = {body: event.body, isBase64Encoded: event.isBase64Encoded};
      return {};
    }
  });
  await serveOnce(createNodeListener(probe), async base => {
    const bin = new Uint8Array([0xff, 0xfe, 0x00, 0x7f]);
    const res = await fetch(`${base}/?confirm=true`, {
      method: 'DELETE',
      headers: {'content-type': 'application/octet-stream'},
      body: bin
    });
    t.equal(res.status, 200, 'DELETE / dispatches via exampleFromContext');
    t.equal(seen.isBase64Encoded, true, 'binary payload marked base64');
    t.equal(Buffer.from(seen.body, 'base64').toString('hex'), 'fffe007f', 'bytes preserved');
  });
});

test('createFetchBridge: round-trip via direct Request/Response', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  const bridge = createFetchBridge(handler);

  const res = await bridge(new Request('http://local.test/?offset=0&limit=2'));
  t.equal(res.status, 200);
  const body = await res.json();
  t.deepEqual(body.data, [{name: 'earth'}, {name: 'mars'}]);
});

test('createFetchBridge: POST JSON body', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  const bridge = createFetchBridge(handler);

  const res = await bridge(
    new Request('http://local.test/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'from-bridge'})
    })
  );
  t.equal(res.status, 204);
  t.deepEqual(adapter.calls[0].item, {name: 'from-bridge'});
});

test('createFetchBridge: v2 cookies flow through to exampleFromContext', async t => {
  const adapter = makeMockAdapter();
  let seenCookie;
  const handler = createLambdaAdapter(adapter, {
    exampleFromContext: ({event}) => {
      seenCookie = event.headers?.cookie;
      return {};
    }
  });
  const bridge = createFetchBridge(handler);
  await bridge(new Request('http://local.test/', {headers: {cookie: 'sid=abc; theme=dark'}}));
  t.equal(seenCookie, 'sid=abc; theme=dark', 'cookie header reaches the handler');
});
