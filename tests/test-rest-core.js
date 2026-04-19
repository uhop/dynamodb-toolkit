import test from 'tape-six';
import {
  parseFields,
  parseSort,
  parseFilter,
  parsePatch,
  parseNames,
  parsePaging,
  parseFlag,
  buildEnvelope,
  buildErrorBody,
  paginationLinks,
  defaultPolicy,
  mapErrorStatus,
  mergePolicy
} from 'dynamodb-toolkit/rest-core';

import {matchRoute} from 'dynamodb-toolkit/handler';

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
