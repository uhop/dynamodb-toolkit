// Body-handling paths: fast-path reject via Content-Length, mid-stream byte
// cap, malformed JSON (400), and empty body.

import test from 'tape-six';

import {createFetchAdapter} from 'dynamodb-toolkit/fetch';

import {makeMockAdapter} from './helpers/mock-adapter-fetch.js';
import {withFetchHandler} from './helpers/with-fetch-handler.js';

test('body stream is parsed from Request', async t => {
  const adapter = makeMockAdapter();
  await withFetchHandler(createFetchAdapter(adapter), async client => {
    const res = await client('/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'stream-parsed'})
    });
    t.equal(res.status, 204);
    t.deepEqual(adapter.calls[0].item, {name: 'stream-parsed'});
  });
});

test('Content-Length over cap → 413 without consuming body', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {maxBodyBytes: 64});
  const huge = JSON.stringify({blob: 'x'.repeat(2000)});
  const res = await handler(
    new Request('http://local.test/', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'content-length': String(huge.length)},
      body: huge
    })
  );
  t.equal(res.status, 413);
  const body = await res.json();
  t.equal(body.code, 'PayloadTooLarge');
  t.equal(adapter.calls.length, 0, 'adapter.post never fired');
});

test('mid-stream overflow (Content-Length missing) → 413', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {maxBodyBytes: 64});

  // Build a Request with a ReadableStream body so the Content-Length header
  // is absent — forces the mid-stream byte counter to catch the overflow.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"blob":"'));
      controller.enqueue(encoder.encode('x'.repeat(2000)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    }
  });
  // `duplex: 'half'` is required by the Fetch spec when passing a
  // ReadableStream body to a Request under Node / Deno.
  const req = new Request('http://local.test/', {method: 'POST', body: stream, duplex: 'half'});

  const res = await handler(req);
  t.equal(res.status, 413);
  const body = await res.json();
  t.equal(body.code, 'PayloadTooLarge');
});

test('malformed JSON returns 400 BadJsonBody', async t => {
  const adapter = makeMockAdapter();
  await withFetchHandler(createFetchAdapter(adapter), async client => {
    const res = await client('/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{not json'
    });
    t.equal(res.status, 400);
    const body = await res.json();
    t.equal(body.code, 'BadJsonBody');
  });
});

test('empty body on POST rejected with 400 BadBody (validateWriteBody)', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter);
  // Fetch disallows GET/HEAD with a body; POST with no body is fine.
  const res = await handler(
    new Request('http://local.test/', {
      method: 'POST',
      headers: {'content-type': 'application/json'}
    })
  );
  t.equal(res.status, 400);
  const body = await res.json();
  t.equal(body.code, 'BadBody');
  t.equal(adapter.calls.length, 0, 'adapter.post never fired on empty body');
});

test('array body on PUT /:key rejected with 400 BadBody', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter);
  const res = await handler(
    new Request('http://local.test/earth', {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify([1, 2, 3])
    })
  );
  t.equal(res.status, 400);
  const body = await res.json();
  t.equal(body.code, 'BadBody');
  t.equal(adapter.calls.length, 0);
});

test('custom maxBodyBytes accepts a body at the limit', async t => {
  const adapter = makeMockAdapter();
  // Object body (validateWriteBody rejects non-objects on POST); JSON
  // envelope is `{"blob":"aaa..."}` — length = 11 + N.
  const payload = JSON.stringify({blob: 'a'.repeat(40)});
  const handler = createFetchAdapter(adapter, {maxBodyBytes: payload.length});
  const res = await handler(
    new Request('http://local.test/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: payload
    })
  );
  t.equal(res.status, 204, 'body at exact cap accepted');
});

test('negative Content-Length → 400 BadContentLength (does not bypass fast-reject)', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {maxBodyBytes: 1024});
  const res = await handler(
    new Request('http://local.test/', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'content-length': '-1'},
      body: JSON.stringify({name: 'x'})
    })
  );
  t.equal(res.status, 400);
  const body = await res.json();
  t.equal(body.code, 'BadContentLength');
  t.equal(adapter.calls.length, 0, 'adapter never called');
});

test('fractional Content-Length → 400 BadContentLength', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {maxBodyBytes: 1024});
  const res = await handler(
    new Request('http://local.test/', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'content-length': '1.5'},
      body: JSON.stringify({name: 'x'})
    })
  );
  t.equal(res.status, 400);
  const body = await res.json();
  t.equal(body.code, 'BadContentLength');
});

test('non-numeric Content-Length → 400 BadContentLength', async t => {
  const adapter = makeMockAdapter();
  const handler = createFetchAdapter(adapter, {maxBodyBytes: 1024});
  const res = await handler(
    new Request('http://local.test/', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'content-length': 'not-a-number'},
      body: JSON.stringify({name: 'x'})
    })
  );
  t.equal(res.status, 400);
  const body = await res.json();
  t.equal(body.code, 'BadContentLength');
});
