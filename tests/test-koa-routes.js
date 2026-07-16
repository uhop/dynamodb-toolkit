// Route coverage: the shared REST wire contract exercised through a real Koa
// app on real HTTP. Koa-specific behavior (dispatch fall-through, body
// readers) lives in test-koa-dispatch.js / test-koa-body.js.

import {createKoaAdapter} from 'dynamodb-toolkit/koa';

import {runRestContract, wrapWebResponse} from './helpers/rest-contract.js';
import {withKoaServer} from './helpers/with-koa-server.js';

runRestContract('koa', (adapter, fn) =>
  withKoaServer(createKoaAdapter(adapter), base => fn(async (path, init) => wrapWebResponse(await fetch(base + path, init))))
);
