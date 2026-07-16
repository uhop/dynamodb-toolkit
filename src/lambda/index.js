// @ts-self-types="./index.d.ts"

// AWS Lambda adapter for dynamodb-toolkit v3.
//
// Translates Lambda event/result shapes (API Gateway v1, v2, Function URL, ALB)
// into the toolkit's framework-agnostic pieces:
//   - matchRoute (dynamodb-toolkit/handler) for route-shape recognition
//   - parsers / builders / policy (dynamodb-toolkit/rest-core) for wire format
//   - a consumer-supplied Adapter for the DynamoDB layer
//
// Wire contract matches the bundled node:http handler plus the koa / express /
// fetch adapters: same routes, same envelope, same status codes, same option
// shape — translated for Lambda's event-in / plain-object-out I/O.

import {
  parsePatch,
  parseNames,
  parseFields,
  parseFlag,
  buildEnvelope,
  paginationLinks,
  mergePolicy,
  mapErrorStatus,
  buildListOptions,
  resolveSort,
  stripMount,
  validateWriteBody
} from '../rest-core/index.js';
import {matchRoute} from '../handler/index.js';

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

export const createLambdaAdapter = (adapter, options = {}) => {
  const policy = mergePolicy(options.policy);
  const sortableIndices = options.sortableIndices || {};
  const keyFromPath = options.keyFromPath || ((rawKey, adp) => ({[adp.keyFields[0].name]: rawKey}));
  const exampleFromContext = options.exampleFromContext || (() => ({}));
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const mountPath = options.mountPath || '';

  const makeExampleCtx = (query, body, event, context) => ({query, body, adapter, framework: 'lambda', event, context});

  const jsonResponse = (status, body) => ({status, body: JSON.stringify(body), headers: JSON_HEADERS});
  const emptyResponse = (status = 204) => ({status, body: ''});
  const errorResponse = err => {
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : mapErrorStatus(err, policy.statusCodes);
    return {status, body: JSON.stringify(policy.errorBody(err)), headers: JSON_HEADERS};
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

  // --- collection-level handlers ---

  const handleGetAll = async (event, context, kind, query) => {
    /** @type {import('../index.js').ListOptions} */
    const opts = buildListOptions(query, policy);
    const {index, descending} = resolveSort(query, sortableIndices);
    if (descending) opts.descending = true;
    const example = exampleFromContext(makeExampleCtx(query, null, event, context));
    const result = await adapter.getList(opts, example, index);

    const links = paginationLinks(result.offset, result.limit, result.total, urlBuilderFor(event, kind));
    const envelopeOpts = {keys: policy.envelope};
    if (links.prev || links.next) envelopeOpts.links = links;
    return jsonResponse(200, buildEnvelope(result, envelopeOpts));
  };

  const handlePost = async event => {
    const body = validateWriteBody(await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes));
    await adapter.post(body);
    return emptyResponse();
  };

  const handleDeleteAll = async (event, context, query) => {
    /** @type {import('../index.js').ListOptions} */
    const opts = buildListOptions(query, policy);
    const {index} = resolveSort(query, sortableIndices);
    const example = exampleFromContext(makeExampleCtx(query, null, event, context));
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.deleteListByParams(params);
    return jsonResponse(200, {processed: r.processed});
  };

  // --- /-by-names handlers ---

  const handleGetByNames = async query => {
    const names = parseNames(query.names);
    const fields = parseFields(query.fields);
    const consistent = parseFlag(query.consistent);
    const keys = names.map(name => keyFromPath(name, adapter));
    const items = await adapter.getByKeys(keys, fields, {consistent});
    return jsonResponse(200, items);
  };

  const handleDeleteByNames = async (event, query) => {
    const namesQ = parseNames(query.names);
    let names = namesQ;
    if (!names.length) {
      const body = await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes);
      if (Array.isArray(body)) names = body.map(s => String(s));
    }
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.deleteByKeys(keys);
    return jsonResponse(200, {processed: r.processed});
  };

  const handleCloneByNames = async (event, query) => {
    const namesQ = parseNames(query.names);
    const body = await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes);
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.cloneByKeys(keys, item => ({...item, ...overlay}));
    return jsonResponse(200, {processed: r.processed});
  };

  const handleMoveByNames = async (event, query) => {
    const namesQ = parseNames(query.names);
    const body = await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes);
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.moveByKeys(keys, item => ({...item, ...overlay}));
    return jsonResponse(200, {processed: r.processed});
  };

  const handleLoad = async event => {
    const body = await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes);
    if (!Array.isArray(body)) {
      return errorResponse(Object.assign(new Error('Body must be an array of items'), {status: 400, code: 'BadLoadBody'}));
    }
    const r = await adapter.putItems(body);
    return jsonResponse(200, {processed: r.processed});
  };

  const handleCloneAll = async (event, context, query) => {
    const body = await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    /** @type {import('../index.js').ListOptions} */
    const opts = buildListOptions(query, policy);
    const {index} = resolveSort(query, sortableIndices);
    const example = exampleFromContext(makeExampleCtx(query, body, event, context));
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.cloneListByParams(params, item => ({...item, ...overlay}));
    return jsonResponse(200, {processed: r.processed});
  };

  const handleMoveAll = async (event, context, query) => {
    const body = await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    /** @type {import('../index.js').ListOptions} */
    const opts = buildListOptions(query, policy);
    const {index} = resolveSort(query, sortableIndices);
    const example = exampleFromContext(makeExampleCtx(query, body, event, context));
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.moveListByParams(params, item => ({...item, ...overlay}));
    return jsonResponse(200, {processed: r.processed});
  };

  // --- item-level handlers ---

  const handleItemGet = async (key, query) => {
    const fields = parseFields(query.fields);
    const consistent = parseFlag(query.consistent);
    const item = await adapter.getByKey(key, fields, {consistent});
    if (item === undefined) return emptyResponse(policy.statusCodes.miss);
    return jsonResponse(200, item);
  };

  const handleItemPut = async (event, key, query) => {
    const body = /** @type {Record<string, unknown>} */ (validateWriteBody(await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes)));
    const force = parseFlag(query.force);
    const merged = {...body, ...key};
    await adapter.put(merged, {force});
    return emptyResponse();
  };

  const handleItemPatch = async (event, key) => {
    const body = /** @type {Record<string, unknown>} */ (validateWriteBody(await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes)));
    const {patch, options: patchOptions} = parsePatch(body, {metaPrefix: policy.metaPrefix});
    await adapter.patch(key, patch, patchOptions);
    return emptyResponse();
  };

  const handleItemDelete = async key => {
    await adapter.delete(key);
    return emptyResponse();
  };

  const handleItemClone = async (event, key, query) => {
    const body = await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const force = parseFlag(query.force);
    const result = await adapter.clone(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return emptyResponse(policy.statusCodes.miss);
    return emptyResponse();
  };

  const handleItemMove = async (event, key, query) => {
    const body = await readJsonBody(event.body, event.isBase64Encoded, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const force = parseFlag(query.force);
    const result = await adapter.move(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return emptyResponse(policy.statusCodes.miss);
    return emptyResponse();
  };

  return async (event, context) => {
    const kind = detectKind(event);
    const multi = wantsMultiValueHeaders(event, kind);
    if (kind === 'v2') flattenV2Cookies(event);

    const method = readMethod(event, kind);
    const pathname = readPath(event, kind);
    const query = coerceQuery(event, kind);
    const adapterPath = stripMount(pathname, mountPath);

    if (adapterPath === null) return finalize(emptyResponse(404), multi);

    const route = matchRoute(method, adapterPath, policy.methodPrefix);
    if (route.kind === 'unknown') return finalize(emptyResponse(404), multi);

    try {
      let neutral;
      switch (route.kind) {
        case 'root':
          if (route.method === 'GET') neutral = await handleGetAll(event, context, kind, query);
          else if (route.method === 'POST') neutral = await handlePost(event);
          else if (route.method === 'DELETE') neutral = await handleDeleteAll(event, context, query);
          break;
        case 'collectionMethod':
          if (route.method === 'GET' && route.name === 'by-names') neutral = await handleGetByNames(query);
          else if (route.method === 'DELETE' && route.name === 'by-names') neutral = await handleDeleteByNames(event, query);
          else if (route.method === 'PUT' && route.name === 'load') neutral = await handleLoad(event);
          else if (route.method === 'PUT' && route.name === 'clone') neutral = await handleCloneAll(event, context, query);
          else if (route.method === 'PUT' && route.name === 'move') neutral = await handleMoveAll(event, context, query);
          else if (route.method === 'PUT' && route.name === 'clone-by-names') neutral = await handleCloneByNames(event, query);
          else if (route.method === 'PUT' && route.name === 'move-by-names') neutral = await handleMoveByNames(event, query);
          break;
        case 'item': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'GET') neutral = await handleItemGet(key, query);
          else if (route.method === 'PUT') neutral = await handleItemPut(event, key, query);
          else if (route.method === 'PATCH') neutral = await handleItemPatch(event, key);
          else if (route.method === 'DELETE') neutral = await handleItemDelete(key);
          break;
        }
        case 'itemMethod': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'PUT' && route.name === 'clone') neutral = await handleItemClone(event, key, query);
          else if (route.method === 'PUT' && route.name === 'move') neutral = await handleItemMove(event, key, query);
          break;
        }
      }
      if (!neutral) {
        neutral = errorResponse(Object.assign(new Error('Method not allowed for this route'), {status: 405, code: 'MethodNotAllowed'}));
      }
      return finalize(neutral, multi);
    } catch (err) {
      return finalize(errorResponse(err), multi);
    }
  };
};
