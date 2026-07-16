// Body-handling paths: base64-encoded body decoding, byte-length cap (413),
// malformed JSON (400), empty body.

import {Buffer} from 'node:buffer';

import test from 'tape-six';

import {createLambdaAdapter} from 'dynamodb-toolkit/lambda';

import {makeMockAdapter} from './helpers/mock-adapter.js';
import {withLambdaHandler, makeClient, readJsonResult, makeV1Event, makeContext} from './helpers/with-lambda-handler.js';

test('utf-8 body is parsed from event.body', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    const res = await client('/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'from-string'})
    });
    t.equal(res.statusCode, 204);
    t.deepEqual(adapter.calls[0].item, {name: 'from-string'});
  });
});

test('base64-encoded body is decoded before parsing', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter);
  const event = makeV1Event('POST', '/', {
    headers: {'content-type': 'application/json'},
    body: Buffer.from(JSON.stringify({name: 'from-base64'}), 'utf-8').toString('base64'),
    isBase64Encoded: true
  });
  const res = await handler(event, makeContext());
  t.equal(res.statusCode, 204);
  t.deepEqual(adapter.calls[0].item, {name: 'from-base64'});
});

test('decoded body over cap → 413 PayloadTooLarge', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter, {maxBodyBytes: 64});
  const huge = JSON.stringify({blob: 'x'.repeat(2000)});
  const client = makeClient(handler);
  const res = await client('/', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: huge
  });
  t.equal(res.statusCode, 413);
  const body = readJsonResult(res);
  t.equal(body.code, 'PayloadTooLarge');
  t.equal(adapter.calls.length, 0, 'adapter.post never fired');
});

test('base64 body over cap → 413 (checked post-decode)', async t => {
  const adapter = makeMockAdapter();
  const handler = createLambdaAdapter(adapter, {maxBodyBytes: 64});
  const huge = JSON.stringify({blob: 'x'.repeat(2000)});
  const event = makeV1Event('POST', '/', {
    headers: {'content-type': 'application/json'},
    body: Buffer.from(huge, 'utf-8').toString('base64'),
    isBase64Encoded: true
  });
  const res = await handler(event, makeContext());
  t.equal(res.statusCode, 413);
  const body = readJsonResult(res);
  t.equal(body.code, 'PayloadTooLarge');
});

test('malformed JSON returns 400 BadJsonBody', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    const res = await client('/', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{not json'
    });
    t.equal(res.statusCode, 400);
    const body = readJsonResult(res);
    t.equal(body.code, 'BadJsonBody');
  });
});

test('empty body on POST rejected with 400 BadBody (validateWriteBody)', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    const res = await client('/', {method: 'POST', headers: {'content-type': 'application/json'}});
    t.equal(res.statusCode, 400);
    const body = readJsonResult(res);
    t.equal(body.code, 'BadBody');
    t.equal(adapter.calls.length, 0, 'adapter.post never fired on empty body');
  });
});

test('array body on PUT /:key rejected with 400 BadBody', async t => {
  const adapter = makeMockAdapter();
  await withLambdaHandler(createLambdaAdapter(adapter), async client => {
    const res = await client('/earth', {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify([1, 2, 3])
    });
    t.equal(res.statusCode, 400);
    const body = readJsonResult(res);
    t.equal(body.code, 'BadBody');
    t.equal(adapter.calls.length, 0);
  });
});

test('custom maxBodyBytes accepts a body at the limit', async t => {
  const adapter = makeMockAdapter();
  // Object body (validateWriteBody rejects non-objects on POST); JSON
  // envelope is `{"blob":"aaa..."}` — length = 11 + N.
  const payload = JSON.stringify({blob: 'a'.repeat(40)});
  const handler = createLambdaAdapter(adapter, {maxBodyBytes: payload.length});
  const client = makeClient(handler);
  const res = await client('/', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: payload
  });
  t.equal(res.statusCode, 204, 'body at exact cap accepted');
});
