// CommonJS smoke test — demonstrates dynamodb-toolkit/express is usable from
// .cjs consumers. Requires a Node that ships unflagged `require(esm)`: 20.19+
// on the 20.x line, 22.12+ on 22.x, anything newer. Our `engines.node` floor
// (>=20) is also the `require(esm)` floor on current 20.x releases.
//
// Scoped to Node only via the tape6 `node` config key — Bun / Deno skip this
// file because CommonJS-from-ESM-sibling semantics differ by runtime.

const {test} = require('tape-six');
const {createExpressAdapter} = require('dynamodb-toolkit/express');

// Minimal adapter stand-in: createExpressAdapter only reads `keyFields` at
// dispatch time, not at factory time. Enough for a require-shape smoke check.
const fakeAdapter = {keyFields: [{name: 'name', type: 'string'}]};

test('cjs: main entry symbols resolve via require()', t => {
  t.equal(typeof createExpressAdapter, 'function', 'createExpressAdapter factory');
});

test('cjs: factory returns an Express-shaped middleware', t => {
  const mw = createExpressAdapter(fakeAdapter);
  t.equal(typeof mw, 'function', 'middleware is a function');
  t.equal(mw.length, 3, 'takes (req, res, next)');
});

test('cjs: factory accepts the full options surface', t => {
  const mw = createExpressAdapter(fakeAdapter, {
    policy: {statusCodes: {miss: 410}},
    sortableIndices: {name: 'by-name-index'},
    keyFromPath: (raw, adp) => ({[adp.keyFields[0].name]: raw}),
    exampleFromContext: ({query}) => ({tenant: query.tenant || 'default'}),
    maxBodyBytes: 64 * 1024
  });
  t.equal(typeof mw, 'function');
});
