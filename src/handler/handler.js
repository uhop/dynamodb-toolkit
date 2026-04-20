// node:http request handler — wires rest-core to a (req, res) function.
// Duck-types req/res so the handler is runtime-neutral (Node, Bun, Deno's std/http compat).

import {
  parseFields,
  parseSort,
  parseFilter,
  parsePatch,
  parseNames,
  parsePaging,
  parseFlag,
  buildEnvelope,
  paginationLinks,
  mergePolicy,
  mapErrorStatus
} from '../rest-core/index.js';

import {matchRoute} from './match-route.js';
import {readJsonBody} from './read-json-body.js';
import {Buffer} from 'node:buffer';

const sendJson = (req, res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const serialized = body == null ? '' : JSON.stringify(body);
  if (req.method === 'HEAD') {
    // HEAD mirrors GET's headers + Content-Length with an empty body.
    res.setHeader('Content-Length', String(Buffer.byteLength(serialized, 'utf8')));
    res.end();
    return;
  }
  res.end(serialized);
};

const sendNoContent = (res, status = 204) => {
  res.statusCode = status;
  res.end();
};

const requestUrl = req => {
  // Strip non-URL-safe characters from the Host header — defends against
  // `new URL('http://a b')` crashes on malformed headers.
  const rawHost = req.headers?.host || 'localhost';
  const host = rawHost.replace(/[^\w.:-]/g, '') || 'localhost';
  // Collapse leading slashes so an attacker can't pivot the URL's origin
  // via `GET //evil.com/path HTTP/1.1`. We only care about path + query here.
  const path = (req.url || '/').replace(/^\/+/, '/');
  return new URL(path, `http://${host}`);
};

export const createHandler = (adapter, options = {}) => {
  const policy = mergePolicy(options.policy);
  const sortableIndices = options.sortableIndices || {};
  const keyFromPath = options.keyFromPath || ((rawKey, adp) => ({[adp.keyFields[0]]: rawKey}));
  const exampleFromContext = options.exampleFromContext || (() => ({}));
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  // Build adapter list options from a parsed query.
  const buildListOptions = query => {
    const fields = parseFields(query.fields);
    const filter = parseFilter(query.filter);
    const paging = parsePaging(query, {defaultLimit: policy.defaultLimit, maxLimit: policy.maxLimit, maxOffset: policy.maxOffset});
    const consistent = parseFlag(query.consistent);
    /** @type {import('../adapter/adapter.js').ListOptions} */
    const out = {
      ...paging,
      consistent,
      needTotal: policy.needTotal
    };
    if (fields) out.fields = fields;
    if (filter) out.filter = filter.query;
    return out;
  };

  // Resolve a `?sort=...` query into {index, descending}.
  const resolveSort = query => {
    const sort = parseSort(query.sort);
    if (!sort) return {index: undefined, descending: false};
    return {index: sortableIndices[sort.field], descending: sort.direction === 'desc'};
  };

  const sendError = (req, res, err) => {
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : mapErrorStatus(err, policy.statusCodes);
    sendJson(req, res, status, policy.errorBody(err));
  };

  // --- collection-level handlers ---

  const handleGetAll = async (req, res, query) => {
    const opts = buildListOptions(query);
    const {index, descending} = resolveSort(query);
    if (descending) opts.descending = true;
    const example = exampleFromContext(query, null);
    const result = await adapter.getAll(opts, example, index);

    const baseUrl = requestUrl(req);
    const urlBuilder = ({offset, limit}) => {
      const u = new URL(baseUrl);
      u.searchParams.set('offset', String(offset));
      u.searchParams.set('limit', String(limit));
      return u.pathname + u.search;
    };
    const links = paginationLinks(result.offset, result.limit, result.total, urlBuilder);
    const envelopeOpts = {keys: policy.envelope};
    if (links.prev || links.next) envelopeOpts.links = links;
    sendJson(req, res, 200, buildEnvelope(result, envelopeOpts));
  };

  const handlePost = async (req, res) => {
    const body = await readJsonBody(req, maxBodyBytes);
    await adapter.post(body);
    sendNoContent(res);
  };

  const handleDeleteAll = async (req, res, query) => {
    const opts = buildListOptions(query);
    const {index} = resolveSort(query);
    const example = exampleFromContext(query, null);
    // For deleteAll we need the params built like getAll, but route through deleteAllByParams
    // by re-using the Adapter's internal list-params machinery via getAll-style options
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.deleteAllByParams(params);
    sendJson(req, res, 200, {processed: r.processed});
  };

  // --- /-by-names handlers ---

  const handleGetByNames = async (req, res, query) => {
    const names = parseNames(query.names);
    const fields = parseFields(query.fields);
    const consistent = parseFlag(query.consistent);
    const keys = names.map(name => keyFromPath(name, adapter));
    const items = await adapter.getByKeys(keys, fields, {consistent});
    sendJson(req, res, 200, items);
  };

  const handleDeleteByNames = async (req, res, query) => {
    const namesQ = parseNames(query.names);
    let names = namesQ;
    if (!names.length) {
      const body = await readJsonBody(req, maxBodyBytes);
      if (Array.isArray(body)) names = body.map(s => String(s));
    }
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.deleteByKeys(keys);
    sendJson(req, res, 200, {processed: r.processed});
  };

  const handleCloneByNames = async (req, res, query) => {
    const namesQ = parseNames(query.names);
    const body = await readJsonBody(req, maxBodyBytes);
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.cloneByKeys(keys, item => ({...item, ...overlay}));
    sendJson(req, res, 200, {processed: r.processed});
  };

  const handleMoveByNames = async (req, res, query) => {
    const namesQ = parseNames(query.names);
    const body = await readJsonBody(req, maxBodyBytes);
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.moveByKeys(keys, item => ({...item, ...overlay}));
    sendJson(req, res, 200, {processed: r.processed});
  };

  const handleLoad = async (req, res) => {
    const body = await readJsonBody(req, maxBodyBytes);
    if (!Array.isArray(body)) {
      return sendError(req, res, Object.assign(new Error('Body must be an array of items'), {status: 400, code: 'BadLoadBody'}));
    }
    const r = await adapter.putAll(body);
    sendJson(req, res, 200, {processed: r.processed});
  };

  const handleCloneAll = async (req, res, query) => {
    const body = await readJsonBody(req, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const opts = buildListOptions(query);
    const {index} = resolveSort(query);
    // Body-always-parsed invariant: pass the parsed body (not null) to
    // exampleFromContext so consumers can derive scope from both query + body.
    const example = exampleFromContext(query, body);
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.cloneAllByParams(params, item => ({...item, ...overlay}));
    sendJson(req, res, 200, {processed: r.processed});
  };

  const handleMoveAll = async (req, res, query) => {
    const body = await readJsonBody(req, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const opts = buildListOptions(query);
    const {index} = resolveSort(query);
    const example = exampleFromContext(query, body);
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.moveAllByParams(params, item => ({...item, ...overlay}));
    sendJson(req, res, 200, {processed: r.processed});
  };

  // --- item-level handlers ---

  const handleItemGet = async (req, res, key, query) => {
    const fields = parseFields(query.fields);
    const consistent = parseFlag(query.consistent);
    const item = await adapter.getByKey(key, fields, {consistent});
    if (item === undefined) return sendNoContent(res, policy.statusCodes.miss);
    sendJson(req, res, 200, item);
  };

  const handleItemPut = async (req, res, key, query) => {
    const body = /** @type {Record<string, unknown> | null | undefined} */ (await readJsonBody(req, maxBodyBytes));
    const force = parseFlag(query.force);
    // Merge URL key into body so the user need not repeat it
    const merged = {...body, ...key};
    await adapter.put(merged, {force});
    sendNoContent(res);
  };

  const handleItemPatch = async (req, res, key) => {
    const body = /** @type {Record<string, unknown> | null | undefined} */ (await readJsonBody(req, maxBodyBytes));
    const {patch, options} = parsePatch(body, {metaPrefix: policy.metaPrefix});
    await adapter.patch(key, patch, options);
    sendNoContent(res);
  };

  const handleItemDelete = async (_req, res, key) => {
    await adapter.delete(key);
    sendNoContent(res);
  };

  const handleItemClone = async (req, res, key, query) => {
    const body = await readJsonBody(req, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const force = parseFlag(query.force);
    const result = await adapter.clone(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return sendNoContent(res, policy.statusCodes.miss);
    sendNoContent(res);
  };

  const handleItemMove = async (req, res, key, query) => {
    const body = await readJsonBody(req, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const force = parseFlag(query.force);
    const result = await adapter.move(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return sendNoContent(res, policy.statusCodes.miss);
    sendNoContent(res);
  };

  return async (req, res) => {
    try {
      const url = requestUrl(req);
      const query = Object.fromEntries(url.searchParams);
      // matchRoute promotes HEAD → GET internally; route.method is effective.
      const route = matchRoute(req.method, url.pathname, policy.methodPrefix);

      switch (route.kind) {
        case 'root':
          if (route.method === 'GET') return await handleGetAll(req, res, query);
          if (route.method === 'POST') return await handlePost(req, res);
          if (route.method === 'DELETE') return await handleDeleteAll(req, res, query);
          break;
        case 'collectionMethod':
          if (route.method === 'GET' && route.name === 'by-names') return await handleGetByNames(req, res, query);
          if (route.method === 'DELETE' && route.name === 'by-names') return await handleDeleteByNames(req, res, query);
          if (route.method === 'PUT' && route.name === 'load') return await handleLoad(req, res);
          if (route.method === 'PUT' && route.name === 'clone') return await handleCloneAll(req, res, query);
          if (route.method === 'PUT' && route.name === 'move') return await handleMoveAll(req, res, query);
          if (route.method === 'PUT' && route.name === 'clone-by-names') return await handleCloneByNames(req, res, query);
          if (route.method === 'PUT' && route.name === 'move-by-names') return await handleMoveByNames(req, res, query);
          break;
        case 'item': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'GET') return await handleItemGet(req, res, key, query);
          if (route.method === 'PUT') return await handleItemPut(req, res, key, query);
          if (route.method === 'PATCH') return await handleItemPatch(req, res, key);
          if (route.method === 'DELETE') return await handleItemDelete(req, res, key);
          break;
        }
        case 'itemMethod': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'PUT' && route.name === 'clone') return await handleItemClone(req, res, key, query);
          if (route.method === 'PUT' && route.name === 'move') return await handleItemMove(req, res, key, query);
          break;
        }
      }
      return sendError(req, res, Object.assign(new Error('Method not allowed for this route'), {status: 405, code: 'MethodNotAllowed'}));
    } catch (err) {
      sendError(req, res, err);
    }
  };
};
