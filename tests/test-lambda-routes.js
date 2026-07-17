// Route coverage: the shared REST wire contract exercised through the Lambda
// handler with synthetic v2 (HTTP API / Function URL) events — the other event
// shapes are covered in test-lambda-kinds.js. Lambda-specific behavior (event
// kinds, base64 bodies, local bridges) lives in the other lambda suites.

import {createLambdaAdapter} from 'dynamodb-toolkit/lambda';

import {runRestContract} from './helpers/rest-contract.js';
import {withLambdaHandler, readJsonResult, readTextResult} from './helpers/with-lambda-handler.js';

runRestContract('lambda', (adapter, fn) =>
  withLambdaHandler(createLambdaAdapter(adapter), client =>
    fn(async (path, init) => {
      const res = await client(path, init);
      return {status: res.statusCode, json: async () => readJsonResult(res), text: async () => readTextResult(res)};
    })
  )
);
