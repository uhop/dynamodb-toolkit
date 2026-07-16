// @ts-self-types="./read-web-body.d.ts"

// Hybrid-strategy JSON body reader for Web Fetch requests. Used by the Fetch
// adapter when a body needs to be read from a `Request`. Mirrors the node:http
// handler's `readJsonBody` wire behavior (413 on overflow, 400 on invalid
// JSON) but works against the Fetch `Request` / `ReadableStream` surface so
// it runs on Cloudflare Workers, Deno Deploy, Bun.serve, and Node 20+.

export const readJsonBody = async (request, maxBodyBytes) => {
  const cl = request.headers.get('content-length');
  if (cl !== null) {
    const n = Number(cl);
    // Require a non-negative integer. `Number.isFinite` alone accepts '-1', '1.5', etc.,
    // letting malformed headers bypass the fast-reject path entirely — the mid-stream
    // counter would still catch real oversize uploads but the advertised pre-stream
    // 413 contract would be quietly violated.
    if (!Number.isInteger(n) || n < 0) {
      throw Object.assign(new Error('Invalid Content-Length'), {status: 400, code: 'BadContentLength'});
    }
    if (n > maxBodyBytes) {
      throw Object.assign(new Error(`Request body exceeds ${maxBodyBytes} bytes`), {status: 413, code: 'PayloadTooLarge'});
    }
  }

  // No body stream (e.g. GET-shaped Request with no body) — let request.text()
  // give the empty string fast-path without setting up a reader.
  if (!request.body) {
    const text = await request.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw Object.assign(err, {status: 400, code: 'BadJsonBody'});
    }
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      // Cancel the upstream reader so the runtime can release socket buffers.
      // Errors from cancel() are swallowed — the rejection below is authoritative.
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw Object.assign(new Error(`Request body exceeds ${maxBodyBytes} bytes`), {status: 413, code: 'PayloadTooLarge'});
    }
    text += decoder.decode(value, {stream: true});
  }
  text += decoder.decode();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw Object.assign(err, {status: 400, code: 'BadJsonBody'});
  }
};
