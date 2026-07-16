// Route coverage: the shared REST wire contract exercised through the Fetch
// handler invoked directly (terminal — no server). Fetch-specific behavior
// (onMiss, mountPath, body readers) lives in test-fetch-dispatch.js /
// test-fetch-body.js.

import {createFetchAdapter} from 'dynamodb-toolkit/fetch';

import {runRestContract, wrapWebResponse} from './helpers/rest-contract.js';
import {withFetchHandler} from './helpers/with-fetch-handler.js';

runRestContract('fetch', (adapter, fn) =>
  withFetchHandler(createFetchAdapter(adapter), client => fn(async (path, init) => wrapWebResponse(await client(path, init))))
);
