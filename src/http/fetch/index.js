// @ts-self-types="./index.d.ts"

// Fetch port of the shared REST engine (../engine.js): translates Web Fetch
// `(request: Request) => Promise<Response>` into the engine's ctx contract and
// renders its neutral results. Wire contract matches the bundled node:http
// handler and the other framework adapters; runs on Cloudflare Workers, Deno
// Deploy, Bun.serve, Hono, itty-router, and Node's native fetch server. Fetch
// quirks owned here: mountPath stripping and the onMiss composition hook
// (return null from onMiss to yield to a parent router).

import {stripMount} from '../../rest-core/index.js';
import {createEngine} from '../engine.js';

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

export const createFetchAdapter = (adapter, options = {}) => {
  const engine = createEngine(adapter, options);
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const mountPath = options.mountPath || '';
  const onMiss = options.onMiss;

  const send = result =>
    result.type === 'empty'
      ? new Response(null, {status: result.status})
      : new Response(JSON.stringify(result.body), {status: result.status, headers: JSON_HEADERS});

  const handleMiss = async request => {
    if (!onMiss) return new Response(null, {status: 404});
    const result = await onMiss(request);
    return result === undefined ? new Response(null, {status: 404}) : result;
  };

  return async request => {
    const url = new URL(request.url);
    const adapterPath = stripMount(url.pathname, mountPath);
    if (adapterPath === null) return handleMiss(request);

    const ctx = {
      method: request.method,
      path: adapterPath,
      query: coerceSearchParams(url.searchParams),
      getBody: () => readJsonBody(request, maxBodyBytes),
      urlBuilder: urlBuilderFor(request),
      extra: {framework: 'fetch', request}
    };

    try {
      const result = await engine.dispatch(ctx);
      if (result === null) return handleMiss(request);
      return send(result);
    } catch (err) {
      return send(engine.error(err));
    }
  };
};
