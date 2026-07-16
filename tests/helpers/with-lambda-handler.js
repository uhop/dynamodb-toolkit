// Lambda adapters are terminal — no server, no ports. The harness builds a
// synthetic event (v1 / v2 / ALB shape) from a `(pathAndQuery, init)` pair and
// invokes the handler directly, mirroring the sibling adapters' `with*Server`
// shape (minus the listen/teardown).

const ORIGIN = 'http://local.test';

export const makeContext = () => ({
  awsRequestId: 'test-req-id',
  functionName: 'test-function',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
  memoryLimitInMB: '128',
  logGroupName: '/aws/lambda/test-function',
  logStreamName: 'test-stream',
  callbackWaitsForEmptyEventLoop: false,
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {}
});

const toHeaderObject = init => {
  const out = {};
  if (!init || !init.headers) return out;
  for (const [k, v] of Object.entries(init.headers)) out[k.toLowerCase()] = String(v);
  return out;
};

const toQueryObjects = url => {
  const qsp = {};
  const mvqsp = {};
  for (const [k, v] of url.searchParams.entries()) {
    (mvqsp[k] = mvqsp[k] || []).push(v);
    if (!(k in qsp)) qsp[k] = v;
  }
  return {
    qsp: Object.keys(qsp).length ? qsp : null,
    mvqsp: Object.keys(mvqsp).length ? mvqsp : null
  };
};

export const makeV1Event = (method, pathAndQuery, init = {}) => {
  const url = new URL(pathAndQuery, ORIGIN);
  const {qsp, mvqsp} = toQueryObjects(url);
  return {
    httpMethod: method,
    path: url.pathname,
    queryStringParameters: qsp,
    multiValueQueryStringParameters: mvqsp,
    headers: toHeaderObject(init),
    multiValueHeaders: null,
    body: init.body ?? null,
    isBase64Encoded: init.isBase64Encoded ?? false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      httpMethod: method,
      path: url.pathname,
      stage: 'test',
      requestId: 'test-req-id',
      resourceId: 'test',
      resourcePath: url.pathname,
      protocol: 'HTTP/1.1',
      identity: {sourceIp: '127.0.0.1'}
    },
    resource: url.pathname,
    stageVariables: null,
    pathParameters: null
  };
};

// API Gateway v1 with multi-value headers / query enabled — headers and query
// arrive as both single-value and multi-value maps.
export const makeV1MultiValueEvent = (method, pathAndQuery, init = {}) => {
  const event = makeV1Event(method, pathAndQuery, init);
  const mvh = {};
  for (const [k, v] of Object.entries(event.headers)) mvh[k] = [v];
  event.multiValueHeaders = mvh;
  return event;
};

export const makeV2Event = (method, pathAndQuery, init = {}) => {
  const url = new URL(pathAndQuery, ORIGIN);
  const qsp = {};
  for (const [k, v] of url.searchParams.entries()) {
    qsp[k] = k in qsp ? `${qsp[k]},${v}` : v;
  }
  const event = {
    version: '2.0',
    routeKey: `${method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: toHeaderObject(init),
    queryStringParameters: Object.keys(qsp).length ? qsp : undefined,
    body: init.body,
    isBase64Encoded: init.isBase64Encoded ?? false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {method, path: url.pathname, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test'},
      requestId: 'test-req-id',
      routeKey: `${method} ${url.pathname}`,
      stage: 'test',
      time: new Date().toISOString(),
      timeEpoch: Date.now()
    }
  };
  if (Array.isArray(init.cookies)) event.cookies = init.cookies;
  return event;
};

export const makeALBEvent = (method, pathAndQuery, init = {}) => {
  const event = makeV1Event(method, pathAndQuery, init);
  event.requestContext = {
    elb: {targetGroupArn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/test/abc'}
  };
  return event;
};

// ALB with multi-value headers mode — headers come through as multiValueHeaders
// only; single-value `headers` is null.
export const makeALBMultiValueEvent = (method, pathAndQuery, init = {}) => {
  const event = makeALBEvent(method, pathAndQuery, init);
  const mvh = {};
  for (const [k, v] of Object.entries(event.headers)) mvh[k] = [v];
  event.headers = null;
  event.multiValueHeaders = mvh;
  return event;
};

const EVENT_FACTORIES = {
  v1: makeV1Event,
  'v1-multi': makeV1MultiValueEvent,
  v2: makeV2Event,
  alb: makeALBEvent,
  'alb-multi': makeALBMultiValueEvent
};

export const makeClient =
  (handler, kind = 'v2') =>
  (pathAndQuery, init = {}) => {
    const factory = EVENT_FACTORIES[kind];
    if (!factory) throw new Error(`unknown event kind: ${kind}`);
    const method = init.method || 'GET';
    const event = factory(method, pathAndQuery, init);
    return handler(event, makeContext());
  };

// Convenience wrapper that keeps test bodies aligned with the sibling
// adapters' `withExpressServer(middleware, async base => { ... })` shape — the
// callback receives a client rather than a base URL.
export const withLambdaHandler = async (handler, fn, kind = 'v2') => {
  const client = makeClient(handler, kind);
  return fn(client);
};

// Parse a Lambda result's body as JSON, handling `isBase64Encoded`.
export const readJsonResult = result => {
  if (!result.body) return null;
  const text = result.isBase64Encoded ? Buffer.from(result.body, 'base64').toString('utf-8') : result.body;
  return text ? JSON.parse(text) : null;
};
