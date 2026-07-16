// @ts-self-types="./index.d.ts"

// AWS Lambda port of the shared REST engine (../engine.js): translates Lambda
// event/result shapes (API Gateway v1, v2, Function URL, ALB) into the
// engine's ctx contract and renders its neutral results. Wire contract
// matches the bundled node:http handler and the other framework adapters.
// Lambda quirks owned here: event-shape auto-detection, v2 cookie flattening,
// multi-value header mirroring, and the Lambda result envelope.

import {stripMount} from '../../rest-core/index.js';
import {createEngine} from '../engine.js';

import {readJsonBody} from './read-lambda-body.js';

const JSON_HEADERS = {'content-type': 'application/json; charset=utf-8'};

// ALB sends `event.requestContext.elb`; API Gateway v2 / Function URL v2.0
// send `event.version === '2.0'`; everything else is API Gateway v1.
const detectKind = event => {
  if (event?.requestContext?.elb) return 'alb';
  if (event?.version === '2.0') return 'v2';
  return 'v1';
};

const readMethod = (event, kind) => (kind === 'v2' ? event.requestContext.http.method : event.httpMethod);
const readPath = (event, kind) => (kind === 'v2' ? event.rawPath : event.path);

// Mirror the request's header mode on the response. In practice this only
// switches for ALB with "Multi value headers" enabled — that trigger delivers
// `multiValueHeaders` with `headers` null-stamped, and strictly requires the
// response in the same shape. API Gateway v1 always delivers BOTH forms and
// accepts either on the response; we emit single-value there as the simpler
// default. v2 / Function URL have no multi-value mode.
const wantsMultiValueHeaders = (event, kind) => {
  if (kind === 'v2') return false;
  // ALB multi-value mode stamps `headers: null` explicitly; require the null
  // sentinel rather than any falsy value so a malformed synthetic event with
  // `headers: undefined` doesn't flip us into multi-value mode.
  return !!(event.multiValueHeaders && event.headers === null);
};

// First-value-wins query object for rest-core parsers — same policy as the koa
// / express / fetch adapters. v1 / ALB may carry both forms; prefer
// `multiValueQueryStringParameters` when present (single-value entries cover
// everything it covers, and sometimes AWS only populates one of the two).
const coerceQuery = (event, kind) => {
  const out = {};
  if (kind !== 'v2' && event.multiValueQueryStringParameters) {
    for (const [k, vs] of Object.entries(event.multiValueQueryStringParameters)) {
      if (vs && vs.length && !(k in out)) out[k] = vs[0];
    }
  }
  if (event.queryStringParameters) {
    for (const [k, v] of Object.entries(event.queryStringParameters)) {
      if (!(k in out)) out[k] = v;
    }
  }
  return out;
};

// Serialize the event's query back into a `?…` string — used to reconstruct
// pagination URLs. Preserves multi-value entries on v1 / ALB.
const serializeQuery = (event, kind) => {
  if (kind === 'v2') return event.rawQueryString || '';
  const sp = new URLSearchParams();
  if (event.multiValueQueryStringParameters) {
    for (const [k, vs] of Object.entries(event.multiValueQueryStringParameters)) {
      for (const v of vs) sp.append(k, v);
    }
  } else if (event.queryStringParameters) {
    for (const [k, v] of Object.entries(event.queryStringParameters)) {
      sp.append(k, v);
    }
  }
  return sp.toString();
};

// API Gateway v2 / Function URL put cookies in `event.cookies: string[]`
// rather than the `Cookie:` header. Mirror them back into `event.headers.cookie`
// so `exampleFromContext` sees one consistent shape across triggers. Mutates
// the event — Lambda events aren't reused across invocations.
const flattenV2Cookies = event => {
  if (!event.cookies || !event.cookies.length) return;
  const headers = event.headers || (event.headers = {});
  const joined = event.cookies.join('; ');
  headers.cookie = headers.cookie ? `${headers.cookie}; ${joined}` : joined;
};

// Neutral → Lambda result envelope. When `multi` is set, headers are lifted
// into `multiValueHeaders` (ALB multi-value mode + v1 with enabled multi-value).
const finalize = (neutral, multi) => {
  const result = {statusCode: neutral.status, body: neutral.body ?? ''};
  if (neutral.headers) {
    if (multi) {
      const mvh = {};
      for (const [k, v] of Object.entries(neutral.headers)) mvh[k] = [v];
      result.multiValueHeaders = mvh;
    } else {
      result.headers = neutral.headers;
    }
  } else if (multi) {
    result.multiValueHeaders = {};
  }
  return result;
};

// Pagination URLs reuse the caller's full path + query — preserves mountPath,
// unrelated query params, and ordering so the client can follow next/prev
// without reconstructing the base URL.
const urlBuilderFor =
  (event, kind) =>
  ({offset, limit}) => {
    const originalPath = kind === 'v2' ? event.rawPath : event.path;
    const sp = new URLSearchParams(serializeQuery(event, kind));
    sp.set('offset', String(offset));
    sp.set('limit', String(limit));
    const out = sp.toString();
    return out ? `${originalPath}?${out}` : originalPath;
  };

export const createLambdaAdapter = (adapter, options = {}) => {
  const engine = createEngine(adapter, options);
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const mountPath = options.mountPath || '';

  const send = result =>
    result.type === 'empty'
      ? {status: result.status, body: ''}
      : {status: result.status, body: JSON.stringify(result.body), headers: JSON_HEADERS};

  return async (event, context) => {
    const kind = detectKind(event);
    const multi = wantsMultiValueHeaders(event, kind);
    if (kind === 'v2') flattenV2Cookies(event);

    const adapterPath = stripMount(readPath(event, kind), mountPath);
    if (adapterPath === null) return finalize({status: 404, body: ''}, multi);

    const ctx = {
      method: readMethod(event, kind),
      path: adapterPath,
      query: coerceQuery(event, kind),
      getBody: () => readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes),
      urlBuilder: urlBuilderFor(event, kind),
      extra: {framework: 'lambda', event, context}
    };

    try {
      const result = await engine.dispatch(ctx);
      if (result === null) return finalize({status: 404, body: ''}, multi);
      return finalize(send(result), multi);
    } catch (err) {
      return finalize(send(engine.error(err)), multi);
    }
  };
};
