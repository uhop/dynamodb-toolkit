// Opaque base64 cursor for resumable mass operations.
//
// The cursor is the only resumption signal a caller needs to plumb through.
// It carries `LastEvaluatedKey` plus any phase / op bookkeeping the mass op
// needs to pick up where it stopped. Callers treat it as opaque; the
// `decodeCursor` helper is intended for tests and debugging only, not a
// stable public contract.

const B64 = {
  encode: obj => {
    const json = JSON.stringify(obj);
    // Prefer Buffer on Node; fall back to btoa elsewhere (Bun, Deno, browsers).
    if (typeof Buffer !== 'undefined') return Buffer.from(json, 'utf8').toString('base64url');
    // btoa is byte-oriented; encode via TextEncoder first.
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode: str => {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'base64url').toString('utf8');
    const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
};

export const encodeCursor = payload => {
  if (!payload || typeof payload !== 'object') throw new TypeError('encodeCursor: payload must be an object');
  return B64.encode(payload);
};

// Debug / test helper — NOT a stable public API. Callers that rely on the
// inner shape will break without notice when mass ops gain new phases.
export const decodeCursor = cursor => {
  if (typeof cursor !== 'string' || !cursor) throw new TypeError('decodeCursor: cursor must be a non-empty string');
  return JSON.parse(B64.decode(cursor));
};
