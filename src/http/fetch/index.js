// @ts-self-types="./index.d.ts"

// Fetch adapter for dynamodb-toolkit v3.
//
// Translates Web Fetch `(request: Request) => Promise<Response>` into the
// toolkit's framework-agnostic pieces:
//   - matchRoute (dynamodb-toolkit/handler) for route-shape recognition
//   - parsers / builders / policy (dynamodb-toolkit/rest-core) for wire format
//   - a consumer-supplied Adapter for the DynamoDB layer
//
// Wire contract matches the bundled node:http handler plus the koa / express
// adapters: same routes, same envelope, same status codes, same option shape
// — translated for Request / Response I/O so it runs on Cloudflare Workers,
// Deno Deploy, Bun.serve, Hono, itty-router, and Node's native fetch server.

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
} from '../../rest-core/index.js';
import {matchRoute} from '../../handler/index.js';

import {readJsonBody} from './read-web-body.js';

const JSON_HEADERS = {'content-type': 'application/json; charset=utf-8'};

// URLSearchParams can carry repeated keys (`?tag=a&tag=b`). rest-core parsers
// want a flat `Record<string, string>`; keep the first value to match the koa
// and express adapters' behavior. Duplicate-key preservation is tracked as an
// upstream 3.2.0 wishlist item.
const coerceSearchParams = searchParams => {
  const out = Object.create(null);
  for (const [k, v] of searchParams.entries()) {
    if (!(k in out)) out[k] = v;
  }
  return out;
};

export const createFetchAdapter = (adapter, options = {}) => {
  const policy = mergePolicy(options.policy);
  const sortableIndices = options.sortableIndices || {};
  const keyFromPath = options.keyFromPath || ((rawKey, adp) => ({[adp.keyFields[0].name]: rawKey}));
  const exampleFromContext = options.exampleFromContext || (() => ({}));
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const mountPath = options.mountPath || '';
  const onMiss = options.onMiss;

  const makeExampleCtx = (query, body, request) => ({query, body, adapter, framework: 'fetch', request});

  const jsonResponse = (status, body) => new Response(JSON.stringify(body), {status, headers: JSON_HEADERS});
  const emptyResponse = (status = 204) => new Response(null, {status});
  const errorResponse = err => {
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : mapErrorStatus(err, policy.statusCodes);
    return new Response(JSON.stringify(policy.errorBody(err)), {status, headers: JSON_HEADERS});
  };

  const handleMiss = async request => {
    if (!onMiss) return emptyResponse(404);
    const result = await onMiss(request);
    return result === undefined ? emptyResponse(404) : result;
  };

  // Pagination URLs reuse the caller's URL verbatim and only rewrite
  // offset/limit — preserves mount prefix, other query params, and casing so
  // the client can follow next/prev without reconstructing the base URL.
  const urlBuilderFor =
    request =>
    ({offset, limit}) => {
      const u = new URL(request.url);
      u.searchParams.set('offset', String(offset));
      u.searchParams.set('limit', String(limit));
      return u.pathname + u.search;
    };

  // --- collection-level handlers ---

  const handleGetAll = async (request, query) => {
    /** @type {import('../../index.js').ListOptions} */
    const opts = buildListOptions(query, policy);
    const {index, descending} = resolveSort(query, sortableIndices);
    if (descending) opts.descending = true;
    const example = exampleFromContext(makeExampleCtx(query, null, request));
    const result = await adapter.getList(opts, example, index);

    const links = paginationLinks(result.offset, result.limit, result.total, urlBuilderFor(request));
    const envelopeOpts = {keys: policy.envelope};
    if (links.prev || links.next) envelopeOpts.links = links;
    return jsonResponse(200, buildEnvelope(result, envelopeOpts));
  };

  const handlePost = async request => {
    const body = validateWriteBody(await readJsonBody(request, maxBodyBytes));
    await adapter.post(body);
    return emptyResponse();
  };

  const handleDeleteAll = async (request, query) => {
    /** @type {import('../../index.js').ListOptions} */
    const opts = buildListOptions(query, policy);
    const {index} = resolveSort(query, sortableIndices);
    const example = exampleFromContext(makeExampleCtx(query, null, request));
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

  const handleDeleteByNames = async (request, query) => {
    const namesQ = parseNames(query.names);
    let names = namesQ;
    if (!names.length) {
      const body = await readJsonBody(request, maxBodyBytes);
      if (Array.isArray(body)) names = body.map(s => String(s));
    }
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.deleteByKeys(keys);
    return jsonResponse(200, {processed: r.processed});
  };

  const handleCloneByNames = async (request, query) => {
    const namesQ = parseNames(query.names);
    const body = await readJsonBody(request, maxBodyBytes);
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.cloneByKeys(keys, item => ({...item, ...overlay}));
    return jsonResponse(200, {processed: r.processed});
  };

  const handleMoveByNames = async (request, query) => {
    const namesQ = parseNames(query.names);
    const body = await readJsonBody(request, maxBodyBytes);
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.moveByKeys(keys, item => ({...item, ...overlay}));
    return jsonResponse(200, {processed: r.processed});
  };

  const handleLoad = async request => {
    const body = await readJsonBody(request, maxBodyBytes);
    if (!Array.isArray(body)) {
      return errorResponse(Object.assign(new Error('Body must be an array of items'), {status: 400, code: 'BadLoadBody'}));
    }
    const r = await adapter.putItems(body);
    return jsonResponse(200, {processed: r.processed});
  };

  const handleCloneAll = async (request, query) => {
    const body = await readJsonBody(request, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    /** @type {import('../../index.js').ListOptions} */
    const opts = buildListOptions(query, policy);
    const {index} = resolveSort(query, sortableIndices);
    const example = exampleFromContext(makeExampleCtx(query, body, request));
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.cloneListByParams(params, item => ({...item, ...overlay}));
    return jsonResponse(200, {processed: r.processed});
  };

  const handleMoveAll = async (request, query) => {
    const body = await readJsonBody(request, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    /** @type {import('../../index.js').ListOptions} */
    const opts = buildListOptions(query, policy);
    const {index} = resolveSort(query, sortableIndices);
    const example = exampleFromContext(makeExampleCtx(query, body, request));
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

  const handleItemPut = async (request, key, query) => {
    const body = /** @type {Record<string, unknown>} */ (validateWriteBody(await readJsonBody(request, maxBodyBytes)));
    const force = parseFlag(query.force);
    const merged = {...body, ...key};
    await adapter.put(merged, {force});
    return emptyResponse();
  };

  const handleItemPatch = async (request, key) => {
    const body = /** @type {Record<string, unknown>} */ (validateWriteBody(await readJsonBody(request, maxBodyBytes)));
    const {patch, options: patchOptions} = parsePatch(body, {metaPrefix: policy.metaPrefix});
    await adapter.patch(key, patch, patchOptions);
    return emptyResponse();
  };

  const handleItemDelete = async key => {
    await adapter.delete(key);
    return emptyResponse();
  };

  const handleItemClone = async (request, key, query) => {
    const body = await readJsonBody(request, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const force = parseFlag(query.force);
    const result = await adapter.clone(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return emptyResponse(policy.statusCodes.miss);
    return emptyResponse();
  };

  const handleItemMove = async (request, key, query) => {
    const body = await readJsonBody(request, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const force = parseFlag(query.force);
    const result = await adapter.move(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return emptyResponse(policy.statusCodes.miss);
    return emptyResponse();
  };

  return async request => {
    const url = new URL(request.url);
    const query = coerceSearchParams(url.searchParams);
    const adapterPath = stripMount(url.pathname, mountPath);

    if (adapterPath === null) return handleMiss(request);

    // matchRoute promotes HEAD → GET internally; route.method is effective.
    const route = matchRoute(request.method, adapterPath, policy.methodPrefix);
    if (route.kind === 'unknown') return handleMiss(request);

    try {
      switch (route.kind) {
        case 'root':
          if (route.method === 'GET') return await handleGetAll(request, query);
          if (route.method === 'POST') return await handlePost(request);
          if (route.method === 'DELETE') return await handleDeleteAll(request, query);
          break;
        case 'collectionMethod':
          if (route.method === 'GET' && route.name === 'by-names') return await handleGetByNames(query);
          if (route.method === 'DELETE' && route.name === 'by-names') return await handleDeleteByNames(request, query);
          if (route.method === 'PUT' && route.name === 'load') return await handleLoad(request);
          if (route.method === 'PUT' && route.name === 'clone') return await handleCloneAll(request, query);
          if (route.method === 'PUT' && route.name === 'move') return await handleMoveAll(request, query);
          if (route.method === 'PUT' && route.name === 'clone-by-names') return await handleCloneByNames(request, query);
          if (route.method === 'PUT' && route.name === 'move-by-names') return await handleMoveByNames(request, query);
          break;
        case 'item': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'GET') return await handleItemGet(key, query);
          if (route.method === 'PUT') return await handleItemPut(request, key, query);
          if (route.method === 'PATCH') return await handleItemPatch(request, key);
          if (route.method === 'DELETE') return await handleItemDelete(key);
          break;
        }
        case 'itemMethod': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'PUT' && route.name === 'clone') return await handleItemClone(request, key, query);
          if (route.method === 'PUT' && route.name === 'move') return await handleItemMove(request, key, query);
          break;
        }
      }
      return errorResponse(Object.assign(new Error('Method not allowed for this route'), {status: 405, code: 'MethodNotAllowed'}));
    } catch (err) {
      return errorResponse(err);
    }
  };
};
