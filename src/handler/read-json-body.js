// Node-stream JSON body reader with a byte-size cap.
//
// Tracks `size` in bytes (measured off each `Buffer` chunk, not UTF-16 code
// units) so a body full of multi-byte UTF-8 (CJK, emoji) can't silently slip
// past the documented-in-bytes cap. Decoding happens incrementally through a
// streaming `TextDecoder('utf-8')` so peak memory stays at ~1× body size —
// `Buffer.concat` + `.toString('utf8')` at the end would hold chunks, concat
// buffer, and decoded string simultaneously (~3×). The streaming decoder also
// handles partial codepoints split across chunk boundaries safely. The 413
// rejection fires mid-stream so a malicious sender pays only the kernel-buffer
// cost until we stop reading.
//
// The runtime-duck-typed `req` interface: `on('data' | 'end' | 'error', fn)` +
// optional `destroy?()`. Works with `node:http`, Koa 2.x ctx.req, Express 4.x
// req. Pass `{destroy: false}` to skip the socket-destroy call (Koa / Express
// need the socket alive so they can write the 413 response).

import {Buffer} from 'node:buffer';

export const readJsonBody = (req, maxBodyBytes, {destroy = true} = {}) =>
  new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8');
    let text = '';
    let size = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBodyBytes) {
        aborted = true;
        reject(Object.assign(new Error(`Request body exceeds ${maxBodyBytes} bytes`), {status: 413, code: 'PayloadTooLarge'}));
        if (destroy) req.destroy?.();
        return;
      }
      text += decoder.decode(buf, {stream: true});
    });
    req.on('end', () => {
      if (aborted) return;
      if (!size) return resolve(null);
      text += decoder.decode();
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(Object.assign(err, {status: 400, code: 'BadJsonBody'}));
      }
    });
    req.on('error', reject);
  });
