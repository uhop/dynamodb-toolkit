// Neutral-result REST engine shared by the framework adapters ("ports").
// Handlers return {type: 'json' | 'text' | 'empty' | 'error', status, body?,
// contentType?, headers?, error?} and never touch a socket — each port
// translates results to its framework's response surface and owns the
// framework quirks (Express headersSent → next, Koa null-body coercion,
// fetch onMiss, Lambda result envelopes). Internal module: not a public
// subpath; the public API is each port's index.js/.d.ts.

import {
  parsePatch,
  parseNames,
  parseFields,
  parseFlag,
  parseCursor,
  parseMassOptions,
  buildEnvelope,
  buildMassResult,
  paginationLinks,
  mergePolicy,
  mapErrorStatus,
  buildListOptions,
  resolveSort,
  validateWriteBody
} from '../rest-core/index.js';
import {matchRoute} from '../handler/index.js';

const json = (status, body) => ({type: 'json', status, body});
const empty = (status = 204) => ({type: 'empty', status});

// JSONL rendering: one item per line, no envelope. Page metadata that has no
// line to live on rides response headers (x-cursor).
const ndjson = result => {
  const out = {
    type: 'text',
    status: 200,
    contentType: 'application/x-ndjson; charset=utf-8',
    body: result.data.map(item => JSON.stringify(item) + '\n').join('')
  };
  if (result.cursor) out.headers = {'x-cursor': result.cursor};
  return out;
};

const overlayOf = body => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

// ctx contract (built per request by the port):
//   method, path        — effective HTTP method + adapter-relative pathname
//   query               — flat Record<string, string>
//   getBody()           — reads + parses the JSON body (port's reader, port's cap)
//   urlBuilder          — ({offset, limit}) => string, for pagination links
//   extra               — merged into the exampleFromContext bag
//                         ({framework, req | ctx | request | event + context})
export const createEngine = (adapter, options = {}) => {
  const policy = mergePolicy(options.policy);
  const sortableIndices = options.sortableIndices || {};
  const keyFromPath = options.keyFromPath || ((rawKey, adp) => ({[adp.keyFields[0].name]: rawKey}));
  const exampleFromContext = options.exampleFromContext || (() => ({}));

  const error = err => ({
    type: 'error',
    status: err?.status && err.status >= 400 && err.status < 600 ? err.status : mapErrorStatus(err, policy.statusCodes),
    body: policy.errorBody(err),
    error: err
  });

  const makeExample = (ctx, body) => exampleFromContext({query: ctx.query, body, adapter, ...ctx.extra});

  // --- collection-level handlers ---

  const handleGetAll = async ctx => {
    /** @type {import('../index.js').ListOptions} */
    const opts = buildListOptions(ctx.query, policy);
    const {index, descending} = resolveSort(ctx.query, sortableIndices);
    if (descending) opts.descending = true;
    const example = makeExample(ctx, null);

    const format = ctx.query.format;
    if (format !== undefined && format !== 'json' && format !== 'jsonl') {
      return error(
        Object.assign(new Error(`Unknown 'format' value '${format}'. Supported: json, jsonl.`), {
          status: 400,
          code: 'BadFormat'
        })
      );
    }
    const jsonl = format === 'jsonl';
    if (jsonl) opts.needTotal = false; // dump mode — skip the COUNT pass

    // Cursor mode: `?cursor` present (empty = first page). Native
    // LastEvaluatedKey paging — no offset, no total, no prev/next links;
    // the envelope's `cursor` is the next-page token.
    if ('cursor' in ctx.query) {
      const cursor = parseCursor(ctx.query.cursor);
      if (cursor) opts.cursor = cursor;
      const result = await adapter.getPage(opts, example, index);
      if (jsonl) return ndjson(result);
      return json(200, buildEnvelope(result, {keys: policy.envelope}));
    }

    const result = await adapter.getList(opts, example, index);
    if (jsonl) return ndjson(result);

    const links = paginationLinks(result.offset, result.limit, result.total, ctx.urlBuilder);
    const envelopeOpts = {keys: policy.envelope};
    if (links.prev || links.next) envelopeOpts.links = links;
    return json(200, buildEnvelope(result, envelopeOpts));
  };

  const handlePost = async ctx => {
    const body = validateWriteBody(await ctx.getBody());
    await adapter.post(body);
    return empty();
  };

  const handleDeleteAll = async ctx => {
    const opts = buildListOptions(ctx.query, policy);
    const {index} = resolveSort(ctx.query, sortableIndices);
    const example = makeExample(ctx, null);
    // Delete-all footgun guard: an unscoped DELETE / must be explicit.
    if (policy.confirmMassDelete && !opts.filter && !opts.search && !(example && Object.keys(example).length) && !parseFlag(ctx.query.confirm)) {
      return error(
        Object.assign(new Error("Unscoped mass delete requires '?confirm=true' (or a filter / search scope)"), {
          status: 400,
          code: 'UnscopedMassDelete'
        })
      );
    }
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.deleteListByParams(params, parseMassOptions(ctx.query));
    return json(200, buildMassResult(r));
  };

  // --- /-by-keys handlers (route + `keys` param; `-by-names` / `names` are legacy aliases) ---

  const namesOf = query => parseNames(query.keys ?? query.names);

  const handleGetByNames = async ctx => {
    const names = namesOf(ctx.query);
    const fields = parseFields(ctx.query.fields);
    const consistent = parseFlag(ctx.query.consistent);
    const keys = names.map(name => keyFromPath(name, adapter));
    const items = await adapter.getByKeys(keys, fields, {consistent});
    return json(200, items);
  };

  const handleDeleteByNames = async ctx => {
    const namesQ = namesOf(ctx.query);
    let names = namesQ;
    if (!names.length) {
      const body = await ctx.getBody();
      if (Array.isArray(body)) names = body.map(s => String(s));
    }
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.deleteByKeys(keys);
    return json(200, buildMassResult(r));
  };

  const handleCloneByNames = async ctx => {
    const namesQ = namesOf(ctx.query);
    const body = await ctx.getBody();
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = overlayOf(body);
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.cloneByKeys(keys, item => ({...item, ...overlay}));
    return json(200, buildMassResult(r));
  };

  const handleMoveByNames = async ctx => {
    const namesQ = namesOf(ctx.query);
    const body = await ctx.getBody();
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = overlayOf(body);
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.moveByKeys(keys, item => ({...item, ...overlay}));
    return json(200, buildMassResult(r));
  };

  const handleLoad = async ctx => {
    const body = await ctx.getBody();
    if (!Array.isArray(body)) {
      return error(Object.assign(new Error('Body must be an array of items'), {status: 400, code: 'BadLoadBody'}));
    }
    const r = await adapter.putItems(body);
    return json(200, buildMassResult(r));
  };

  const handleCloneAll = async ctx => {
    const body = await ctx.getBody();
    const overlay = overlayOf(body);
    const opts = buildListOptions(ctx.query, policy);
    const {index} = resolveSort(ctx.query, sortableIndices);
    const example = makeExample(ctx, body);
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.cloneListByParams(params, item => ({...item, ...overlay}), parseMassOptions(ctx.query));
    return json(200, buildMassResult(r));
  };

  const handleMoveAll = async ctx => {
    const body = await ctx.getBody();
    const overlay = overlayOf(body);
    const opts = buildListOptions(ctx.query, policy);
    const {index} = resolveSort(ctx.query, sortableIndices);
    const example = makeExample(ctx, body);
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.moveListByParams(params, item => ({...item, ...overlay}), parseMassOptions(ctx.query));
    return json(200, buildMassResult(r));
  };

  // --- item-level handlers ---

  const handleItemGet = async (ctx, key) => {
    const fields = parseFields(ctx.query.fields);
    const consistent = parseFlag(ctx.query.consistent);
    const item = await adapter.getByKey(key, fields, {consistent});
    if (item === undefined) return empty(policy.statusCodes.miss);
    return json(200, item);
  };

  const handleItemPut = async (ctx, key) => {
    const body = /** @type {Record<string, unknown>} */ (validateWriteBody(await ctx.getBody()));
    const force = parseFlag(ctx.query.force);
    const merged = {...body, ...key};
    await adapter.put(merged, {force});
    return empty();
  };

  const handleItemPatch = async (ctx, key) => {
    const body = /** @type {Record<string, unknown>} */ (validateWriteBody(await ctx.getBody()));
    const {patch, options: patchOptions} = parsePatch(body, {metaPrefix: policy.metaPrefix});
    await adapter.patch(key, patch, patchOptions);
    return empty();
  };

  const handleItemDelete = async (_ctx, key) => {
    await adapter.delete(key);
    return empty();
  };

  const handleItemClone = async (ctx, key) => {
    const body = await ctx.getBody();
    const overlay = overlayOf(body);
    const force = parseFlag(ctx.query.force);
    const result = await adapter.clone(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return empty(policy.statusCodes.miss);
    return empty();
  };

  const handleItemMove = async (ctx, key) => {
    const body = await ctx.getBody();
    const overlay = overlayOf(body);
    const force = parseFlag(ctx.query.force);
    const result = await adapter.move(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return empty(policy.statusCodes.miss);
    return empty();
  };

  // Returns null for an unrecognized route shape — the port decides what a
  // miss means (Express/Koa fall through to the middleware chain, fetch runs
  // onMiss, Lambda answers 404).
  const dispatch = async ctx => {
    // matchRoute promotes HEAD → GET internally; route.method is effective.
    const route = matchRoute(ctx.method, ctx.path, policy.methodPrefix);
    if (route.kind === 'unknown') return null;

    try {
      switch (route.kind) {
        case 'root':
          if (route.method === 'GET') return await handleGetAll(ctx);
          if (route.method === 'POST') return await handlePost(ctx);
          if (route.method === 'DELETE') return await handleDeleteAll(ctx);
          break;
        case 'collectionMethod': {
          const byKeys = route.name === 'by-keys' || route.name === 'by-names';
          if (route.method === 'GET' && byKeys) return await handleGetByNames(ctx);
          if (route.method === 'DELETE' && byKeys) return await handleDeleteByNames(ctx);
          if (route.method === 'PUT' && route.name === 'load') return await handleLoad(ctx);
          if (route.method === 'PUT' && route.name === 'clone') return await handleCloneAll(ctx);
          if (route.method === 'PUT' && route.name === 'move') return await handleMoveAll(ctx);
          if (route.method === 'PUT' && (route.name === 'clone-by-keys' || route.name === 'clone-by-names')) return await handleCloneByNames(ctx);
          if (route.method === 'PUT' && (route.name === 'move-by-keys' || route.name === 'move-by-names')) return await handleMoveByNames(ctx);
          break;
        }
        case 'item': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'GET') return await handleItemGet(ctx, key);
          if (route.method === 'PUT') return await handleItemPut(ctx, key);
          if (route.method === 'PATCH') return await handleItemPatch(ctx, key);
          if (route.method === 'DELETE') return await handleItemDelete(ctx, key);
          break;
        }
        case 'itemMethod': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'PUT' && route.name === 'clone') return await handleItemClone(ctx, key);
          if (route.method === 'PUT' && route.name === 'move') return await handleItemMove(ctx, key);
          break;
        }
      }
      // Route shape matched, but no handler for this method — explicit 405.
      return error(Object.assign(new Error('Method not allowed for this route'), {status: 405, code: 'MethodNotAllowed'}));
    } catch (err) {
      return error(err);
    }
  };

  return {dispatch, error, policy};
};
