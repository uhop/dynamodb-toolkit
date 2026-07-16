// CommonJS smoke test — demonstrates dynamodb-toolkit/fetch is usable from
// .cjs consumers. Requires a Node that ships unflagged `require(esm)`: 20.19+
// on the 20.x line, 22.12+ on 22.x, anything newer. Our `engines.node` floor
// (>=20) is also the `require(esm)` floor on current 20.x releases.
//
// Scoped to Node only via the tape6 `node` config key — Bun / Deno skip this
// file because CommonJS-from-ESM-sibling semantics differ by runtime.

const {test} = require('tape-six');
const {createFetchAdapter} = require('dynamodb-toolkit/fetch');
const {readJsonBody} = require('dynamodb-toolkit/http/fetch/read-web-body.js');

// Minimal adapter stand-in: createFetchAdapter only reads `keyFields` at
// dispatch time, not at factory time. Enough for a require-shape smoke check.
const fakeAdapter = {keyFields: [{name: 'name', type: 'string'}]};

test('cjs: main entry symbols resolve via require()', t => {
  t.equal(typeof createFetchAdapter, 'function', 'createFetchAdapter factory');
});

test('cjs: sub-exports resolve via require()', t => {
  t.equal(typeof readJsonBody, 'function', 'readJsonBody helper');
});

test('cjs: factory returns a fetch handler', t => {
  const handler = createFetchAdapter(fakeAdapter);
  t.equal(typeof handler, 'function', 'handler is a function');
  t.equal(handler.length, 1, 'takes a single (request) arg');
});

test('cjs: factory accepts the full options surface', t => {
  const handler = createFetchAdapter(fakeAdapter, {
    policy: {statusCodes: {miss: 410}},
    sortableIndices: {name: 'by-name-index'},
    keyFromPath: (raw, adp) => ({[adp.keyFields[0].name]: raw}),
    exampleFromContext: ({query}) => ({tenant: query.tenant || 'default'}),
    maxBodyBytes: 64 * 1024,
    mountPath: '/things',
    onMiss: () => null
  });
  t.equal(typeof handler, 'function');
});
