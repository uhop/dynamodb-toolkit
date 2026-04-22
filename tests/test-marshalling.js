import test from 'tape-six';
import {
  marshallDateISO,
  unmarshallDateISO,
  marshallDateEpoch,
  unmarshallDateEpoch,
  dateISO,
  dateEpoch,
  marshallMap,
  unmarshallMap,
  marshallURL,
  unmarshallURL,
  url
} from 'dynamodb-toolkit/marshalling';

// Date — ISO

test('marshallDateISO: Date → ISO 8601 string', t => {
  const d = new Date('2026-04-22T12:00:00Z');
  t.equal(marshallDateISO(d), '2026-04-22T12:00:00.000Z');
});

test('marshallDateISO: undefined / null pass through', t => {
  t.equal(marshallDateISO(undefined), undefined);
  t.equal(marshallDateISO(null), null);
});

test('marshallDateISO: non-Date throws', t => {
  t.throws(() => marshallDateISO('not a date'), 'rejects string');
  t.throws(() => marshallDateISO(1000), 'rejects number');
});

test('unmarshallDateISO: ISO string → Date', t => {
  const s = '2026-04-22T12:00:00.000Z';
  const d = unmarshallDateISO(s);
  t.ok(d instanceof Date);
  t.equal(d.toISOString(), s);
});

test('dateISO: round-trip via Marshaller pair', t => {
  const d = new Date('2026-04-22T00:00:00Z');
  t.equal(dateISO.unmarshall(dateISO.marshall(d)).getTime(), d.getTime());
});

// Date — epoch

test('marshallDateEpoch: Date → ms number', t => {
  const d = new Date('2026-04-22T12:00:00Z');
  t.equal(marshallDateEpoch(d), d.getTime());
  t.equal(typeof marshallDateEpoch(d), 'number');
});

test('unmarshallDateEpoch: ms → Date', t => {
  const ms = 1745323200000;
  const d = unmarshallDateEpoch(ms);
  t.ok(d instanceof Date);
  t.equal(d.getTime(), ms);
});

test('dateEpoch: round-trip via Marshaller pair', t => {
  const d = new Date('2026-04-22T00:00:00Z');
  t.equal(dateEpoch.unmarshall(dateEpoch.marshall(d)).getTime(), d.getTime());
});

// Map

test('marshallMap: Map<string, V> → {}', t => {
  const m = new Map([
    ['a', 1],
    ['b', 2]
  ]);
  const obj = marshallMap(m);
  t.deepEqual(obj, {a: 1, b: 2});
});

test('marshallMap: valueTransform applied per value', t => {
  const m = new Map([
    ['a', new Date('2026-01-01T00:00:00Z')],
    ['b', new Date('2026-02-01T00:00:00Z')]
  ]);
  const obj = marshallMap(m, marshallDateISO);
  t.equal(obj.a, '2026-01-01T00:00:00.000Z');
  t.equal(obj.b, '2026-02-01T00:00:00.000Z');
});

test('marshallMap: undefined / null pass through', t => {
  t.equal(marshallMap(undefined), undefined);
  t.equal(marshallMap(null), null);
});

test('marshallMap: non-string key throws', t => {
  const m = new Map();
  m.set(42, 'x');
  t.throws(() => marshallMap(m), 'non-string key rejected');
});

test('marshallMap: non-Map throws', t => {
  t.throws(() => marshallMap({a: 1}), 'plain object rejected');
});

test('unmarshallMap: {} → Map<string, V>', t => {
  const obj = {a: 1, b: 2};
  const m = unmarshallMap(obj);
  t.ok(m instanceof Map);
  t.equal(m.get('a'), 1);
  t.equal(m.get('b'), 2);
});

test('unmarshallMap: valueTransform applied per value', t => {
  const obj = {a: '2026-01-01T00:00:00.000Z'};
  const m = unmarshallMap(obj, unmarshallDateISO);
  t.ok(m.get('a') instanceof Date);
});

test('unmarshallMap: hostile __proto__ key does not pollute Object.prototype', t => {
  const obj = Object.create(null);
  obj.__proto__ = {polluted: 'yes'};
  unmarshallMap(obj);
  t.equal({}.polluted, undefined, 'Object.prototype not polluted');
});

// URL

test('marshallURL: URL → string (href)', t => {
  const u = new URL('https://example.com/path?q=1');
  t.equal(marshallURL(u), 'https://example.com/path?q=1');
});

test('marshallURL: undefined / null pass through', t => {
  t.equal(marshallURL(undefined), undefined);
  t.equal(marshallURL(null), null);
});

test('marshallURL: non-URL throws', t => {
  t.throws(() => marshallURL('https://example.com'), 'string rejected — must pass URL instance');
});

test('unmarshallURL: string → URL', t => {
  const u = unmarshallURL('https://example.com/path');
  t.ok(u instanceof URL);
  t.equal(u.hostname, 'example.com');
});

test('url: round-trip via Marshaller pair', t => {
  const u = new URL('https://example.com/?a=1');
  t.equal(url.unmarshall(url.marshall(u)).href, u.href);
});

// Composition — Map<string, Date> round-trip via outer+inner Marshallers

test('Composition: Map<string, Date> round-trips via nested marshalling', t => {
  const m = new Map([
    ['renewAt', new Date('2026-06-01T00:00:00Z')],
    ['expireAt', new Date('2026-12-01T00:00:00Z')]
  ]);
  const stored = marshallMap(m, marshallDateISO);
  const back = unmarshallMap(stored, unmarshallDateISO);
  t.equal(back.get('renewAt').getTime(), m.get('renewAt').getTime());
  t.equal(back.get('expireAt').getTime(), m.get('expireAt').getTime());
});
