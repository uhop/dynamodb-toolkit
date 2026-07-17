// @ts-self-types="./index.d.ts"

// Koa port of the shared REST engine (../engine.js): translates Koa
// `(ctx, next)` into the engine's ctx contract and renders its neutral
// results. Wire contract matches the bundled node:http handler and the other
// framework adapters. Koa quirk owned here: ctx.body === null coerces into a
// 204 when the current status isn't in the empty-body set, which would
// clobber a 404/410/etc — an empty string keeps the chosen status.

import {coerceStringQuery} from '../../rest-core/index.js';
import {readJsonBody} from '../../handler/index.js';
import {createEngine} from '../engine.js';

// Prefer a pre-parsed body (koa-bodyparser, @koa/bodyparser, koa-body…). Fall
// back to streaming the raw Node request with our own cap. Pre-parsed bodies
// bypass maxBodyBytes — the body parser is expected to enforce its own cap.
const getBody = async (kctx, maxBodyBytes) => {
  if (kctx.request && kctx.request.body !== undefined) return kctx.request.body;
  // `destroy: false` — Koa needs the socket alive so we can still write the
  // 413 response. readJsonBody otherwise would destroy the underlying stream.
  return readJsonBody(kctx.req, maxBodyBytes, {destroy: false});
};

const urlBuilderFor = kctx => {
  // ctx.originalUrl is the full path+query as received (before any upstream
  // middleware rewrote ctx.url). Building pagination links off it means the
  // next/prev URLs point back at the same endpoint the client hit.
  const base = new URL(kctx.originalUrl || kctx.url || '/', 'http://local');
  return ({offset, limit}) => {
    const u = new URL(base);
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('limit', String(limit));
    return u.pathname + u.search;
  };
};

export const createKoaAdapter = (adapter, options = {}) => {
  const engine = createEngine(adapter, options);
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  const send = (kctx, result) => {
    kctx.status = result.status;
    if (result.type === 'text') {
      // Content-Type must land before the body assignment — Koa's body setter
      // only infers a type when the header is still unset.
      kctx.set('content-type', result.contentType);
      if (result.headers) kctx.set(result.headers);
      kctx.body = result.body;
      return;
    }
    kctx.body = result.type === 'empty' ? '' : result.body;
  };

  return async (kctx, next) => {
    const ctx = {
      method: kctx.method,
      path: kctx.path,
      query: coerceStringQuery(kctx.query),
      getBody: () => getBody(kctx, maxBodyBytes),
      urlBuilder: urlBuilderFor(kctx),
      extra: {framework: 'koa', ctx: kctx}
    };

    try {
      const result = await engine.dispatch(ctx);
      // Unknown route shape — hand back to the Koa middleware chain so other
      // handlers (or Koa's default 404) can respond.
      if (result === null) return next();
      send(kctx, result);
    } catch (err) {
      send(kctx, engine.error(err));
    }
  };
};
