// @ts-self-types="./index.d.ts"

// Express port of the shared REST engine (../engine.js): translates Express
// `(req, res, next)` into the engine's ctx contract and renders its neutral
// results. Wire contract matches the bundled node:http handler and the other
// framework adapters. Express quirks owned here: Express 4 doesn't auto-await
// async handlers (dispatch().catch(next)), and once headers are flushed,
// res.status() throws ERR_HTTP_HEADERS_SENT — errors then forward via next()
// so Express's error pipeline can close the socket without swallowing the
// original cause.

import {coerceStringQuery} from '../../rest-core/index.js';
import {readJsonBody} from '../../handler/index.js';
import {createEngine} from '../engine.js';

// Prefer a pre-parsed body (`express.json()` or equivalent populates
// `req.body`). Fall back to streaming the raw Node request with our own cap.
// Pre-parsed bodies bypass maxBodyBytes — the body parser is expected to
// enforce its own cap.
const getBody = async (req, maxBodyBytes) => {
  if (req.body !== undefined) return req.body;
  // Pre-consumed stream (e.g. a prior custom middleware read req up to EOF
  // without populating req.body): resolve null instead of hanging.
  if (req.readableEnded || req.complete) return null;
  // `destroy: false` — Express needs the socket alive so the 413 response
  // still flushes.
  return readJsonBody(req, maxBodyBytes, {destroy: false});
};

const urlBuilderFor = req => {
  // req.originalUrl is the full path+query as received (before any upstream
  // middleware or `app.use(prefix, adapter)` rewrote req.url). Building
  // pagination links off it means the next/prev URLs point back at the
  // same endpoint the client hit.
  const base = new URL(req.originalUrl || req.url || '/', 'http://local');
  return ({offset, limit}) => {
    const u = new URL(base);
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('limit', String(limit));
    return u.pathname + u.search;
  };
};

export const createExpressAdapter = (adapter, options = {}) => {
  const engine = createEngine(adapter, options);
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  const send = (res, next, result) => {
    if (result.type === 'error' && res.headersSent) return next(result.error);
    res.status(result.status);
    // `res.end()` (not `res.json()`) keeps the configured status with a truly
    // empty body — avoids shipping "null" for 204/404/410/etc.
    if (result.type === 'empty') return res.end();
    res.json(result.body);
  };

  return (req, res, next) => {
    const ctx = {
      method: req.method,
      path: req.path,
      query: coerceStringQuery(req.query),
      getBody: () => getBody(req, maxBodyBytes),
      urlBuilder: urlBuilderFor(req),
      extra: {framework: 'express', req}
    };

    const dispatch = async () => {
      try {
        const result = await engine.dispatch(ctx);
        // Unknown route shape — hand back to the Express middleware chain so
        // other handlers (or Express's default 404) can respond.
        if (result === null) return next();
        send(res, next, result);
      } catch (err) {
        send(res, next, engine.error(err));
      }
    };

    dispatch().catch(next);
  };
};
