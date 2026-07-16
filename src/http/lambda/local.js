// @ts-self-types="./local.d.ts"

// Zero-dependency local-debug bridges: drive the exact Lambda handler from real
// HTTP traffic on a dev machine without deploying to AWS. Each bridge
// synthesizes a full v1/v2 API Gateway event from the incoming request, invokes
// the handler, and translates the result envelope back into an HTTP response.
// No framework deps by design — tenants on Koa / Express copy a few lines of
// glue from the wiki rather than pull a second integration library in here.

import {Buffer} from 'node:buffer';

const SAFE_METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);

// AWS's own binary-vs-text rule — text-ish content types flow through as a
// JS string, everything else as base64. Matches API Gateway's default binary
// media type behavior closely enough for local testing.
const isTextContentType = ct => {
  if (!ct) return true;
  const [type] = String(ct).split(';');
  const t = type.trim().toLowerCase();
  if (t.startsWith('text/')) return true;
  if (t === 'application/json' || t === 'application/javascript' || t === 'application/xml' || t === 'application/x-www-form-urlencoded') return true;
  if (t.endsWith('+json') || t.endsWith('+xml')) return true;
  return false;
};

const encodeBody = (bytes, contentType) => {
  if (!bytes || bytes.length === 0) return {body: null, isBase64Encoded: false};
  if (isTextContentType(contentType)) {
    return {body: bytes.toString('utf-8'), isBase64Encoded: false};
  }
  return {body: bytes.toString('base64'), isBase64Encoded: true};
};

const defaultContext = () => ({
  awsRequestId: 'local-' + Math.random().toString(36).slice(2, 10),
  functionName: 'local',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:local:000000000000:function:local',
  memoryLimitInMB: '128',
  logGroupName: '/aws/lambda/local',
  logStreamName: 'local',
  callbackWaitsForEmptyEventLoop: false,
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {}
});

const makeV1Event = (method, url, headers, body, isBase64Encoded) => {
  const qsp = {};
  const mvqsp = {};
  for (const [k, v] of url.searchParams.entries()) {
    (mvqsp[k] = mvqsp[k] || []).push(v);
    if (!(k in qsp)) qsp[k] = v;
  }
  const mvh = {};
  for (const [k, v] of Object.entries(headers)) mvh[k] = Array.isArray(v) ? v : [v];
  return {
    httpMethod: method,
    path: url.pathname,
    queryStringParameters: Object.keys(qsp).length ? qsp : null,
    multiValueQueryStringParameters: Object.keys(mvqsp).length ? mvqsp : null,
    headers,
    multiValueHeaders: mvh,
    body,
    isBase64Encoded,
    requestContext: {
      accountId: '000000000000',
      apiId: 'local',
      httpMethod: method,
      path: url.pathname,
      stage: 'local',
      requestId: 'local-' + Date.now(),
      protocol: 'HTTP/1.1',
      identity: {sourceIp: '127.0.0.1'}
    },
    resource: url.pathname,
    stageVariables: null,
    pathParameters: null
  };
};

const makeV2Event = (method, url, headers, body, isBase64Encoded) => {
  const cookies = [];
  const headersOut = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'cookie') {
      const value = Array.isArray(v) ? v.join('; ') : v;
      for (const part of value.split(/;\s*/)) if (part) cookies.push(part);
      continue;
    }
    headersOut[k] = Array.isArray(v) ? v.join(',') : v;
  }
  const qsp = {};
  for (const [k, v] of url.searchParams.entries()) {
    qsp[k] = k in qsp ? `${qsp[k]},${v}` : v;
  }
  const event = {
    version: '2.0',
    routeKey: `${method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: headersOut,
    queryStringParameters: Object.keys(qsp).length ? qsp : undefined,
    body,
    isBase64Encoded,
    requestContext: {
      accountId: '000000000000',
      apiId: 'local',
      domainName: url.host,
      domainPrefix: 'local',
      http: {method, path: url.pathname, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: String(headers['user-agent'] || '')},
      requestId: 'local-' + Date.now(),
      routeKey: `${method} ${url.pathname}`,
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now()
    }
  };
  if (cookies.length) event.cookies = cookies;
  return event;
};

// Consume a Node IncomingMessage fully into a Buffer. No cap here — the Lambda
// adapter applies its own `maxBodyBytes`.
const readNodeBody = req =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const writeNodeResult = (res, result) => {
  res.statusCode = result.statusCode || 200;
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  }
  if (result.multiValueHeaders) {
    for (const [k, vs] of Object.entries(result.multiValueHeaders)) res.setHeader(k, vs);
  }
  if (Array.isArray(result.cookies) && result.cookies.length) {
    const existing = res.getHeader('set-cookie');
    const all = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...result.cookies];
    res.setHeader('set-cookie', all);
  }
  if (!result.body) {
    res.end();
    return;
  }
  res.end(result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body);
};

const normalizeOptions = options => ({
  eventShape: options.eventShape || 'v2',
  makeContext: options.context ? () => options.context : options.makeContext || defaultContext
});

export const createNodeListener = (handler, options = {}) => {
  const {eventShape, makeContext} = normalizeOptions(options);
  const makeEvent = eventShape === 'v1' ? makeV1Event : makeV2Event;

  return async (req, res) => {
    try {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url || '/', `http://${host}`);
      const hasBody = !SAFE_METHODS_WITHOUT_BODY.has(req.method || 'GET');
      const bytes = hasBody ? await readNodeBody(req) : Buffer.alloc(0);
      const {body, isBase64Encoded} = encodeBody(bytes, req.headers['content-type']);
      const event = makeEvent(req.method || 'GET', url, {...req.headers}, body, isBase64Encoded);
      const result = await handler(event, makeContext());
      writeNodeResult(res, result);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({code: err?.code || 'InternalError', message: err?.message || 'internal error'}));
    }
  };
};

export const createFetchBridge = (handler, options = {}) => {
  const {eventShape, makeContext} = normalizeOptions(options);
  const makeEvent = eventShape === 'v1' ? makeV1Event : makeV2Event;

  return async request => {
    const url = new URL(request.url);
    const headers = {};
    for (const [k, v] of request.headers.entries()) headers[k] = v;
    const bytes = SAFE_METHODS_WITHOUT_BODY.has(request.method) ? Buffer.alloc(0) : Buffer.from(new Uint8Array(await request.arrayBuffer()));
    const {body, isBase64Encoded} = encodeBody(bytes, request.headers.get('content-type'));
    const event = makeEvent(request.method, url, headers, body, isBase64Encoded);
    const result = await handler(event, makeContext());

    const resHeaders = new Headers();
    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) resHeaders.set(k, String(v));
    }
    if (result.multiValueHeaders) {
      for (const [k, vs] of Object.entries(result.multiValueHeaders)) {
        for (const v of vs) resHeaders.append(k, String(v));
      }
    }
    if (Array.isArray(result.cookies)) {
      for (const c of result.cookies) resHeaders.append('set-cookie', c);
    }
    const resBody = result.body ? (result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body) : null;
    return new Response(resBody, {status: result.statusCode || 200, headers: resHeaders});
  };
};
