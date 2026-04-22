import test from 'tape-six';
import {
  parseFields,
  parseSort,
  parseFilter,
  parsePatch,
  parseNames,
  parsePaging,
  parseFlag,
  coerceStringQuery,
  buildEnvelope,
  buildErrorBody,
  paginationLinks,
  buildListOptions,
  resolveSort,
  stripMount,
  validateWriteBody,
  defaultPolicy,
  mapErrorStatus,
  mergePolicy
} from 'dynamodb-toolkit/rest-core';

import {matchRoute, createHandler, readJsonBody} from 'dynamodb-toolkit/handler';
import {Adapter} from 'dynamodb-toolkit';
import {EventEmitter} from 'node:events';
import {makeMockClient} from './helpers/mock-client.js';

// --- parseFields ---

test('parseFields: comma-separated string', t => {
  t.deepEqual(parseFields('name,climate,terrain'), ['name', 'climate', 'terrain']);
});

test('parseFields: trims whitespace', t => {
  t.deepEqual(parseFields(' a , b , c '), ['a', 'b', 'c']);
});

test('parseFields: empty inputs return null', t => {
  t.equal(parseFields(null), null);
  t.equal(parseFields(undefined), null);
  t.equal(parseFields(''), null);
  t.equal(parseFields([]), null);
  t.equal(parseFields(',, ,'), null);
});

test('parseFields: array input passes through with trim', t => {
  t.deepEqual(parseFields(['a', ' b ', '']), ['a', 'b']);
});

// --- parseSort ---

test('parseSort: ascending by default', t => {
  const s = parseSort('name');
  t.equal(s.field, 'name');
  t.equal(s.direction, 'asc');
});

test('parseSort: leading - means descending', t => {
  const s = parseSort('-name');
  t.equal(s.field, 'name');
  t.equal(s.direction, 'desc');
});

test('parseSort: multi-field returns chain', t => {
  const s = parseSort('a,-b,c');
  t.equal(s.field, 'a');
  t.equal(s.chain.length, 3);
  t.equal(s.chain[1].direction, 'desc');
});

test('parseSort: empty returns null', t => {
  t.equal(parseSort(null), null);
  t.equal(parseSort(''), null);
});

// --- parseFilter ---

test('parseFilter: returns query', t => {
  t.deepEqual(parseFilter('foo'), {query: 'foo'});
});

test('parseFilter: empty returns null', t => {
  t.equal(parseFilter(null), null);
  t.equal(parseFilter(''), null);
  t.equal(parseFilter('   '), null);
});

test('parseFilter: passes through mode + caseSensitive options', t => {
  const f = parseFilter('foo', {mode: 'prefix', caseSensitive: true});
  t.equal(f.mode, 'prefix');
  t.equal(f.caseSensitive, true);
});

// --- parsePatch ---

test('parsePatch: separates patch from meta', t => {
  const r = parsePatch({name: 'A', climate: 'cold', _delete: ['oldField'], _separator: '/'});
  t.deepEqual(r.patch, {name: 'A', climate: 'cold'});
  t.deepEqual(r.options.delete, ['oldField']);
  t.equal(r.options.separator, '/');
});

test('parsePatch: custom metaPrefix', t => {
  const r = parsePatch({name: 'A', __delete: ['x']}, {metaPrefix: '__'});
  t.deepEqual(r.patch, {name: 'A'});
  t.deepEqual(r.options.delete, ['x']);
});

test('parsePatch: arrayOps passthrough', t => {
  const r = parsePatch({_arrayOps: [{op: 'append', path: 'tags', values: ['x']}]});
  t.equal(r.options.arrayOps.length, 1);
});

test('parsePatch: null body returns empty patch', t => {
  const r = parsePatch(null);
  t.deepEqual(r.patch, {});
  t.deepEqual(r.options, {});
});

test('parsePatch: __proto__ in body does not pollute the returned patch prototype', t => {
  const body = JSON.parse('{"__proto__": {"polluted": "yes"}, "name": "ok"}');
  const r = parsePatch(body);
  t.equal(r.patch.name, 'ok', 'ordinary keys still parsed');
  t.equal(Object.getPrototypeOf(r.patch), null, 'patch has null prototype');
  t.equal(r.patch.polluted, undefined, 'no pollution leaked via prototype');
});

// --- parseNames ---

test('parseNames: comma string', t => {
  t.deepEqual(parseNames('A,B,C'), ['A', 'B', 'C']);
});

test('parseNames: array', t => {
  t.deepEqual(parseNames(['A', 'B']), ['A', 'B']);
});

test('parseNames: empty', t => {
  t.deepEqual(parseNames(null), []);
  t.deepEqual(parseNames(''), []);
});

// --- parsePaging ---

test('parsePaging: defaults', t => {
  const r = parsePaging({});
  t.equal(r.offset, 0);
  t.equal(r.limit, 10);
});

test('parsePaging: parses string numerics', t => {
  const r = parsePaging({offset: '5', limit: '20'});
  t.equal(r.offset, 5);
  t.equal(r.limit, 20);
});

test('parsePaging: clamps to maxLimit', t => {
  const r = parsePaging({limit: 5000}, {maxLimit: 50});
  t.equal(r.limit, 50);
});

test('parsePaging: negative offset → 0', t => {
  const r = parsePaging({offset: -5});
  t.equal(r.offset, 0);
});

test('parsePaging: invalid limit → default', t => {
  const r = parsePaging({limit: 'abc'}, {defaultLimit: 7});
  t.equal(r.limit, 7);
});

test('parsePaging: caps offset at maxOffset (DoS guard)', t => {
  const r = parsePaging({offset: 1e15});
  t.equal(r.offset, 100_000, 'huge offset clamped to default maxOffset');
});

test('parsePaging: maxOffset override', t => {
  const r = parsePaging({offset: 5000}, {maxOffset: 200});
  t.equal(r.offset, 200);
});

test('parseFields: truncates to maxItems default 1000', t => {
  const input = Array.from({length: 1500}, (_, i) => 'f' + i).join(',');
  const r = parseFields(input);
  t.equal(r.length, 1000, 'capped at default');
});

test('parseFields: maxItems override', t => {
  const r = parseFields('a,b,c,d', {maxItems: 2});
  t.deepEqual(r, ['a', 'b']);
});

test('parseNames: truncates to maxItems default 1000', t => {
  const arr = Array.from({length: 1500}, (_, i) => 'n' + i);
  const r = parseNames(arr);
  t.equal(r.length, 1000);
});

test('parseFilter: truncates to maxLength default 1024', t => {
  const input = 'a'.repeat(2000);
  const r = parseFilter(input);
  t.equal(r.query.length, 1024, 'capped at default');
});

test('parseFilter: maxLength override', t => {
  const r = parseFilter('abcdefgh', {maxLength: 4});
  t.equal(r.query, 'abcd');
});

// --- parseFlag ---

test('parseFlag: positive truthy values', t => {
  t.equal(parseFlag('yes'), true);
  t.equal(parseFlag('YES'), true);
  t.equal(parseFlag('true'), true);
  t.equal(parseFlag('1'), true);
  t.equal(parseFlag('on'), true);
  t.equal(parseFlag(true), true);
});

test('parseFlag: everything else is false', t => {
  t.equal(parseFlag('no'), false);
  t.equal(parseFlag('false'), false);
  t.equal(parseFlag('0'), false);
  t.equal(parseFlag(null), false);
  t.equal(parseFlag(undefined), false);
});

// --- buildEnvelope ---

test('buildEnvelope: default keys', t => {
  const env = buildEnvelope({data: [1, 2], offset: 0, limit: 10, total: 2});
  t.deepEqual(env, {data: [1, 2], offset: 0, limit: 10, total: 2});
});

test('buildEnvelope: omits total when undefined', t => {
  const env = buildEnvelope({data: [], offset: 0, limit: 10});
  t.equal(env.total, undefined);
});

test('buildEnvelope: custom keys', t => {
  const env = buildEnvelope({data: [1], offset: 0, limit: 10, total: 1}, {keys: {items: 'rows', total: 'count'}});
  t.deepEqual(env.rows, [1]);
  t.equal(env.count, 1);
  t.equal(env.data, undefined);
});

test('buildEnvelope: includes links when provided', t => {
  const env = buildEnvelope({data: [], offset: 0, limit: 10, total: 0}, {links: {prev: null, next: '/next'}});
  t.deepEqual(env.links, {prev: null, next: '/next'});
});

// --- buildErrorBody ---

test('buildErrorBody: name and message', t => {
  const e = new Error('boom');
  e.name = 'BadThing';
  const body = buildErrorBody(e);
  t.equal(body.code, 'BadThing');
  t.equal(body.message, 'boom');
});

test('buildErrorBody: includeDebug adds stack', t => {
  const e = new Error('boom');
  const body = buildErrorBody(e, {includeDebug: true});
  t.ok(body.stack);
});

test('buildErrorBody: errorId echoed', t => {
  const body = buildErrorBody(new Error('x'), {errorId: 'abc'});
  t.equal(body.errorId, 'abc');
});

// --- paginationLinks ---

test('paginationLinks: prev/next', t => {
  const links = paginationLinks(10, 10, 30, ({offset, limit}) => `?o=${offset}&l=${limit}`);
  t.equal(links.prev, '?o=0&l=10');
  t.equal(links.next, '?o=20&l=10');
});

test('paginationLinks: at first page, prev=null', t => {
  const links = paginationLinks(0, 10, 30, ({offset, limit}) => `?o=${offset}&l=${limit}`);
  t.equal(links.prev, null);
  t.ok(links.next);
});

test('paginationLinks: at last page, next=null', t => {
  const links = paginationLinks(20, 10, 30, ({offset, limit}) => `?o=${offset}&l=${limit}`);
  t.equal(links.next, null);
});

test('paginationLinks: no urlBuilder returns nulls', t => {
  const links = paginationLinks(10, 10, 30);
  t.equal(links.prev, null);
  t.equal(links.next, null);
});

// --- policy + mapErrorStatus ---

test('mapErrorStatus: ConditionalCheckFailedException → 409', t => {
  t.equal(mapErrorStatus({name: 'ConditionalCheckFailedException'}), 409);
});

test('mapErrorStatus: ValidationException → 422', t => {
  t.equal(mapErrorStatus({name: 'ValidationException'}), 422);
});

test('mapErrorStatus: throughput → 429', t => {
  t.equal(mapErrorStatus({name: 'ProvisionedThroughputExceededException'}), 429);
});

test('mapErrorStatus: 5xx httpStatusCode → 503', t => {
  t.equal(mapErrorStatus({name: 'Whatever', $metadata: {httpStatusCode: 502}}), 503);
});

test('mapErrorStatus: unknown → 500', t => {
  t.equal(mapErrorStatus({name: 'Wat'}), 500);
});

test('mergePolicy: deep-merges envelope and statusCodes', t => {
  const p = mergePolicy({envelope: {items: 'rows'}, statusCodes: {miss: 410}});
  t.equal(p.envelope.items, 'rows');
  t.equal(p.envelope.total, 'total', 'preserves default');
  t.equal(p.statusCodes.miss, 410);
  t.equal(p.statusCodes.consistency, 409, 'preserves default');
});

test('defaultPolicy: snapshot of expected defaults', t => {
  t.equal(defaultPolicy.metaPrefix, '_');
  t.equal(defaultPolicy.methodPrefix, '-');
  t.equal(defaultPolicy.envelope.items, 'data');
  t.equal(defaultPolicy.statusCodes.miss, 404);
  t.equal(defaultPolicy.defaultLimit, 10);
  t.equal(defaultPolicy.maxLimit, 100);
  t.equal(defaultPolicy.maxOffset, 100_000);
});

// --- matchRoute ---

test('matchRoute: root', t => {
  t.equal(matchRoute('GET', '/').kind, 'root');
  t.equal(matchRoute('POST', '').kind, 'root');
});

test('matchRoute: /:key', t => {
  const r = matchRoute('GET', '/Tatooine');
  t.equal(r.kind, 'item');
  t.equal(r.key, 'Tatooine');
});

test('matchRoute: URL-decodes key', t => {
  const r = matchRoute('GET', '/Star%20Wars');
  t.equal(r.key, 'Star Wars');
});

test('matchRoute: collection method /-by-names', t => {
  const r = matchRoute('GET', '/-by-names');
  t.equal(r.kind, 'collectionMethod');
  t.equal(r.name, 'by-names');
});

test('matchRoute: /:key/-clone', t => {
  const r = matchRoute('PUT', '/Hoth/-clone');
  t.equal(r.kind, 'itemMethod');
  t.equal(r.key, 'Hoth');
  t.equal(r.name, 'clone');
});

test('matchRoute: configurable methodPrefix', t => {
  const r = matchRoute('GET', '/__special', '__');
  t.equal(r.kind, 'collectionMethod');
  t.equal(r.name, 'special');
});

test('matchRoute: deeply nested → unknown', t => {
  const r = matchRoute('GET', '/a/b/c');
  t.equal(r.kind, 'unknown');
});

// --- createHandler: hardening ---

const makeFakeReq = (method, url, {host = 'localhost', body} = {}) => {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {host};
  req.setEncoding = () => {};
  req.destroy = () => {};
  if (body !== undefined) {
    setImmediate(() => {
      req.emit('data', body);
      req.emit('end');
    });
  }
  return req;
};

const makeFakeRes = () => {
  const headers = {};
  let statusCode = 200;
  let body = '';
  let ended = false;
  return {
    get statusCode() {
      return statusCode;
    },
    set statusCode(v) {
      statusCode = v;
    },
    setHeader: (k, v) => (headers[k] = v),
    end: chunk => {
      if (chunk) body += chunk;
      ended = true;
    },
    get body() {
      return body;
    },
    get ended() {
      return ended;
    },
    get headers() {
      return headers;
    }
  };
};

const waitForResponse = res =>
  new Promise(resolve =>
    setImmediate(function poll() {
      if (res.ended) return resolve();
      setImmediate(poll);
    })
  );

const makeTestAdapter = () =>
  new Adapter({
    client: makeMockClient(async () => ({})),
    table: 'T',
    keyFields: ['name']
  });

test('createHandler: oversized body → 413 PayloadTooLarge', async t => {
  const handler = createHandler(makeTestAdapter(), {maxBodyBytes: 10});
  const req = makeFakeReq('POST', '/', {body: 'x'.repeat(100)});
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.equal(res.statusCode, 413);
  t.matchString(res.body, /PayloadTooLarge/);
});

test('createHandler: body within limit → normal processing', async t => {
  const handler = createHandler(makeTestAdapter(), {maxBodyBytes: 1024});
  const req = makeFakeReq('POST', '/', {body: JSON.stringify({name: 'x'})});
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.equal(res.statusCode, 204, 'small body accepted');
});

test('createHandler: double-slash in req.url does not pivot origin', async t => {
  const handler = createHandler(makeTestAdapter());
  const req = makeFakeReq('GET', '//evil.com/Hoth');
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  // Should be treated as item route with key 'evil.com' (one level deep) — NOT origin-pivoted.
  // Actually the normalized path is '/evil.com/Hoth' → two segments → itemMethod or unknown.
  // The important check: no crash, returns a valid HTTP response.
  t.ok(res.statusCode >= 400 && res.statusCode < 500, 'returns a normal client error, not a crash');
});

test('createHandler: malformed Host header does not crash', async t => {
  const handler = createHandler(makeTestAdapter());
  const req = makeFakeReq('GET', '/Hoth', {host: 'a b c'});
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.ok(res.ended, 'response sent');
  t.ok(res.statusCode, 'valid status assigned');
});

test('createHandler: 405 error body does not echo url.pathname', async t => {
  const handler = createHandler(makeTestAdapter());
  const req = makeFakeReq('PATCH', '/'); // PATCH not supported on root
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.equal(res.statusCode, 405);
  t.doesNotMatchString(res.body, /\/[a-z]/, 'pathname not leaked in error body');
});

// --- coerceStringQuery ---

test('coerceStringQuery: filters to strings only', t => {
  const out = coerceStringQuery({a: 'x', b: 42, c: {nested: 1}, d: ['first', 'second']});
  t.deepEqual(Object.keys(out).sort(), ['a', 'd']);
  t.equal(out.a, 'x');
  t.equal(out.d, 'first');
});

test('coerceStringQuery: null / undefined return empty', t => {
  t.deepEqual(Object.keys(coerceStringQuery(null)), []);
  t.deepEqual(Object.keys(coerceStringQuery(undefined)), []);
});

test('coerceStringQuery: null-prototype accumulator', t => {
  const out = coerceStringQuery({constructor: 'evil'});
  t.equal(out.constructor, 'evil');
  t.notOk(Object.getPrototypeOf(out), 'no prototype to pollute');
});

// --- stripMount ---

test('stripMount: request under mount returns tail', t => {
  t.equal(stripMount('/planets/Tatooine', '/planets'), '/Tatooine');
  t.equal(stripMount('/planets', '/planets'), '/');
  t.equal(stripMount('/planets/', '/planets'), '/');
});

test('stripMount: trailing slash on mountPath is normalized', t => {
  t.equal(stripMount('/planets/Tatooine', '/planets/'), '/Tatooine');
  t.equal(stripMount('/planets', '/planets/'), '/');
});

test('stripMount: partial prefix match returns null (not accidental hit)', t => {
  t.equal(stripMount('/planetsburg', '/planets'), null);
  t.equal(stripMount('/other', '/planets'), null);
});

test('stripMount: empty / missing mount returns pathname as-is', t => {
  t.equal(stripMount('/foo', ''), '/foo');
  t.equal(stripMount('/foo', undefined), '/foo');
  t.equal(stripMount('', ''), '/');
});

// --- validateWriteBody ---

test('validateWriteBody: plain objects pass', t => {
  const body = {name: 'x'};
  t.equal(validateWriteBody(body), body);
  t.deepEqual(validateWriteBody({}), {});
});

test('validateWriteBody: null / undefined / array / primitives rejected', t => {
  const expectBadBody = input => {
    let caught;
    try {
      validateWriteBody(input);
    } catch (err) {
      caught = err;
    }
    t.ok(caught, 'rejected');
    t.equal(caught && caught.status, 400);
    t.equal(caught && caught.code, 'BadBody');
  };
  expectBadBody(null);
  expectBadBody(undefined);
  expectBadBody([1, 2, 3]);
  expectBadBody('string');
  expectBadBody(42);
});

test('validateWriteBody: allowEmpty lets null / undefined through', t => {
  t.equal(validateWriteBody(null, {allowEmpty: true}), null);
  t.equal(validateWriteBody(undefined, {allowEmpty: true}), undefined);
});

test('validateWriteBody: allowArray lets arrays through', t => {
  const arr = [{a: 1}, {b: 2}];
  t.equal(validateWriteBody(arr, {allowArray: true}), arr);
});

// --- buildListOptions + resolveSort ---

test('buildListOptions: composes parsers with policy caps', t => {
  const policy = mergePolicy({defaultLimit: 5, maxLimit: 50, maxOffset: 1000});
  const out = buildListOptions({offset: '20', limit: '30', fields: 'a,b', filter: 'x'}, policy);
  t.equal(out.offset, 20);
  t.equal(out.limit, 30);
  t.deepEqual(out.fields, ['a', 'b']);
  t.equal(out.filter, 'x');
});

test('buildListOptions: missing values fall back to policy', t => {
  const policy = mergePolicy({defaultLimit: 7});
  const out = buildListOptions({}, policy);
  t.equal(out.limit, 7);
  t.equal(out.offset, 0);
});

test('resolveSort: ascending + descending', t => {
  t.deepEqual(resolveSort({sort: 'name'}, {name: 'name-gsi'}), {index: 'name-gsi', descending: false});
  t.deepEqual(resolveSort({sort: '-name'}, {name: 'name-gsi'}), {index: 'name-gsi', descending: true});
});

test('resolveSort: no sort returns {index: undefined}', t => {
  t.deepEqual(resolveSort({}, {name: 'name-gsi'}), {index: undefined, descending: false});
});

test('resolveSort: unmapped sort field throws NoIndexForSortField', t => {
  let threw;
  try {
    resolveSort({sort: 'unknown'}, {name: 'name-gsi'});
  } catch (err) {
    threw = err;
  }
  t.ok(threw);
  t.equal(threw.name, 'NoIndexForSortField');
  t.equal(threw.sortField, 'unknown');
});

// --- matchRoute HEAD → GET ---

test('matchRoute: HEAD request dispatches through GET handler', t => {
  const r = matchRoute('HEAD', '/Tatooine');
  t.equal(r.kind, 'item');
  t.equal(r.method, 'GET', 'effective method is GET');
  t.equal(r.head, true, 'head flag set');
});

test('matchRoute: non-HEAD keeps method verbatim', t => {
  const r = matchRoute('POST', '/');
  t.equal(r.method, 'POST');
  t.equal(r.head, false);
});

// --- readJsonBody (Node Buffer) ---

test('readJsonBody: parses valid JSON', async t => {
  const req = new EventEmitter();
  setImmediate(() => {
    req.emit('data', Buffer.from('{"a":1}', 'utf8'));
    req.emit('end');
  });
  const body = await readJsonBody(req, 1024);
  t.deepEqual(body, {a: 1});
});

test('readJsonBody: empty body resolves to null', async t => {
  const req = new EventEmitter();
  setImmediate(() => req.emit('end'));
  const body = await readJsonBody(req, 1024);
  t.equal(body, null);
});

test('readJsonBody: byte cap measured in bytes, not UTF-16 code units', async t => {
  // 4 astral emoji = 16 bytes in UTF-8 (4 bytes × 4 chars).
  // In UTF-16 s.length would be 8 (surrogate pairs per emoji).
  // With cap = 8 this must now reject (byte count is 16).
  const req = new EventEmitter();
  setImmediate(() => {
    req.emit('data', Buffer.from('"🌍🌏🌎🌍"', 'utf8'));
    req.emit('end');
  });
  let caught;
  try {
    await readJsonBody(req, 8);
  } catch (err) {
    caught = err;
  }
  t.ok(caught, 'rejected');
  t.equal(caught.status, 413);
  t.equal(caught.code, 'PayloadTooLarge');
});

test('readJsonBody: malformed JSON → 400 BadJsonBody', async t => {
  const req = new EventEmitter();
  setImmediate(() => {
    req.emit('data', Buffer.from('{not json', 'utf8'));
    req.emit('end');
  });
  let caught;
  try {
    await readJsonBody(req, 1024);
  } catch (err) {
    caught = err;
  }
  t.equal(caught.status, 400);
  t.equal(caught.code, 'BadJsonBody');
});

test('readJsonBody: multi-chunk UTF-8 sequences decode correctly (no partial-codepoint hazard)', async t => {
  // Split a 4-byte emoji across two chunks — old string-accumulation version
  // relied on setEncoding('utf8') + StringDecoder to handle this; Buffer
  // accumulation sidesteps by decoding once after concat.
  const full = Buffer.from('{"planet":"🌍"}', 'utf8');
  const midEmoji = full.indexOf(0xf0) + 2; // split inside the 4-byte sequence
  const req = new EventEmitter();
  setImmediate(() => {
    req.emit('data', full.subarray(0, midEmoji));
    req.emit('data', full.subarray(midEmoji));
    req.emit('end');
  });
  const body = await readJsonBody(req, 1024);
  t.deepEqual(body, {planet: '🌍'});
});

// --- Bundled handler: HEAD + body-always-parsed invariants ---

test('createHandler: HEAD /:key returns 200 headers + empty body with Content-Length', async t => {
  const adapter = makeTestAdapter();
  adapter.getByKey = async () => ({name: 'Hoth', climate: 'frozen'});
  const handler = createHandler(adapter);
  const req = makeFakeReq('HEAD', '/Hoth');
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.equal(res.statusCode, 200);
  t.equal(res.body, '', 'no body written for HEAD');
  t.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  t.ok(res.headers['Content-Length'], 'Content-Length set');
  t.equal(Number(res.headers['Content-Length']), JSON.stringify({name: 'Hoth', climate: 'frozen'}).length);
});

test('createHandler: HEAD / dispatches through GET (pagination envelope headers, empty body)', async t => {
  const adapter = makeTestAdapter();
  adapter.getList = async () => ({data: [{name: 'a'}], offset: 0, limit: 10, total: 1});
  const handler = createHandler(adapter);
  const req = makeFakeReq('HEAD', '/');
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.equal(res.statusCode, 200);
  t.equal(res.body, '');
  t.ok(res.headers['Content-Length']);
});

test('createHandler: body-always-parsed invariant — exampleFromContext receives parsed body on PUT /-clone', async t => {
  const adapter = makeTestAdapter();
  let capturedBody;
  adapter._buildListParams = async () => ({TableName: 'T'});
  adapter.cloneListByParams = async () => ({processed: 0});
  const handler = createHandler(adapter, {
    exampleFromContext: (_query, body) => {
      capturedBody = body;
      return {};
    }
  });
  const req = makeFakeReq('PUT', '/-clone', {body: JSON.stringify({overlay: 'ok'})});
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.deepEqual(capturedBody, {overlay: 'ok'}, 'body parsed and passed through, not null');
});

// --- ?fields=*keys wildcard ---

test('createHandler: ?fields=*keys expands to adapter keyField names', async t => {
  const adapter = makeTestAdapter();
  // makeTestAdapter builds keyFields: [{name: 'name', type: 'string'}] already.
  let capturedOpts;
  adapter.getList = async opts => {
    capturedOpts = opts;
    return {data: [], offset: 0, limit: 10, total: 0};
  };
  const handler = createHandler(adapter);
  const req = makeFakeReq('GET', '/?fields=*keys');
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.deepEqual(capturedOpts.fields, ['name']);
});

test('createHandler: ?fields=*keys,extra dedups + expands', async t => {
  const adapter = makeTestAdapter();
  // Override keyFields for this test (makeTestAdapter defaults to single-field 'name').
  adapter.keyFields = [
    {name: 'state', type: 'string'},
    {name: 'rentalName', type: 'string'}
  ];
  let capturedOpts;
  adapter.getList = async opts => {
    capturedOpts = opts;
    return {data: [], offset: 0, limit: 10, total: 0};
  };
  const handler = createHandler(adapter);
  const req = makeFakeReq('GET', '/?fields=*keys,state,climate');
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  // state appears once (dedup); order preserves *keys expansion first, then climate.
  t.deepEqual(capturedOpts.fields, ['state', 'rentalName', 'climate']);
});

test('createHandler: unknown wildcard returns 500 (from thrown Error)', async t => {
  const adapter = makeTestAdapter();
  const handler = createHandler(adapter);
  const req = makeFakeReq('GET', '/?fields=*unknown');
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  // Unknown wildcard → generic Error → 500 via mapErrorStatus default.
  t.equal(res.statusCode, 500);
  const body = JSON.parse(res.body);
  t.matchString(body.message || body.error || JSON.stringify(body), /\*unknown/);
});

test('createHandler: no wildcard → fields pass through', async t => {
  const adapter = makeTestAdapter();
  let capturedOpts;
  adapter.getList = async opts => {
    capturedOpts = opts;
    return {data: [], offset: 0, limit: 10, total: 0};
  };
  const handler = createHandler(adapter);
  const req = makeFakeReq('GET', '/?fields=a,b');
  const res = makeFakeRes();
  const p = handler(req, res);
  await waitForResponse(res);
  await p;
  t.deepEqual(capturedOpts.fields, ['a', 'b']);
});
