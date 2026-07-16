// Route coverage: the shared REST wire contract exercised through a real
// Express app on real HTTP. Express-specific behavior (dispatch fall-through,
// body readers) lives in test-express-dispatch.js / test-express-body.js.

import {createExpressAdapter} from 'dynamodb-toolkit/express';

import {runRestContract, wrapWebResponse} from './helpers/rest-contract.js';
import {withExpressServer} from './helpers/with-express-server.js';

runRestContract('express', (adapter, fn) =>
  withExpressServer(createExpressAdapter(adapter), base => fn(async (path, init) => wrapWebResponse(await fetch(base + path, init))))
);
