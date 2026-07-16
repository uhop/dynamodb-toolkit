// @ts-self-types="./read-lambda-body.d.ts"

// Lambda delivers request bodies as already-buffered strings, so this reader is
// synchronous — no stream to guard, unlike the parent's stream-based reader.
// Base64 decode precedes the size check so the cap applies to decoded bytes.

import {Buffer} from 'node:buffer';

export const readJsonBody = (body, isBase64Encoded, maxBodyBytes) => {
  if (body == null || body === '') return null;

  let text;
  if (isBase64Encoded) {
    const bytes = Buffer.from(body, 'base64');
    if (bytes.length > maxBodyBytes) {
      throw Object.assign(new Error(`Request body exceeds ${maxBodyBytes} bytes`), {status: 413, code: 'PayloadTooLarge'});
    }
    text = bytes.toString('utf-8');
  } else {
    const byteLength = Buffer.byteLength(body, 'utf-8');
    if (byteLength > maxBodyBytes) {
      throw Object.assign(new Error(`Request body exceeds ${maxBodyBytes} bytes`), {status: 413, code: 'PayloadTooLarge'});
    }
    text = body;
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw Object.assign(err, {status: 400, code: 'BadJsonBody'});
  }
};
