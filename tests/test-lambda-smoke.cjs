// CommonJS smoke test — demonstrates dynamodb-toolkit/lambda is usable from
// .cjs consumers (useful for classic AWS Lambda deployments that haven't
// switched to ESM yet). Requires a Node that ships unflagged `require(esm)`:
// 20.19+ on the 20.x line, 22.12+ on 22.x, anything newer. Our `engines.node`
// floor (>=20) is also the `require(esm)` floor on current 20.x releases.
//
// Scoped to Node only via the tape6 `node` config key — Bun / Deno skip this
// file because CommonJS-from-ESM-sibling semantics differ by runtime.

const {test} = require('tape-six');
const {createLambdaAdapter} = require('dynamodb-toolkit/lambda');
const {readJsonBody} = require('dynamodb-toolkit/http/lambda/read-lambda-body.js');

// Minimal adapter stand-in: createLambdaAdapter only reads `keyFields` at
// dispatch time, not at factory time. Enough for a require-shape smoke check.
const fakeAdapter = {keyFields: [{name: 'name', type: 'string'}]};

test('cjs: main entry symbols resolve via require()', t => {
  t.equal(typeof createLambdaAdapter, 'function', 'createLambdaAdapter factory');
});

test('cjs: sub-exports resolve via require()', t => {
  t.equal(typeof readJsonBody, 'function', 'readJsonBody helper');
});

test('cjs: factory returns a Lambda handler', t => {
  const handler = createLambdaAdapter(fakeAdapter);
  t.equal(typeof handler, 'function', 'handler is a function');
  t.equal(handler.length, 2, 'takes (event, context)');
});

test('cjs: factory accepts the full options surface', t => {
  const handler = createLambdaAdapter(fakeAdapter, {
    policy: {statusCodes: {miss: 410}},
    sortableIndices: {name: 'by-name-index'},
    keyFromPath: (raw, adp) => ({[adp.keyFields[0].name]: raw}),
    exampleFromContext: ({query, event}) => ({tenant: query.tenant || event.headers?.['x-tenant'] || 'default'}),
    maxBodyBytes: 64 * 1024,
    mountPath: '/things'
  });
  t.equal(typeof handler, 'function');
});
