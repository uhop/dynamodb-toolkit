// @ts-self-types="./build-envelope.d.ts"
// Build a paginated response envelope. Keys are policy-configurable.
// Default shape: {data, total, offset, limit} for offset paging;
// {data, limit, cursor?} for cursor paging.

export const buildEnvelope = (result, options = {}) => {
  const keys = options.keys || {};
  const items = keys.items || 'data';
  const total = keys.total || 'total';
  const offset = keys.offset || 'offset';
  const limit = keys.limit || 'limit';

  // Null-prototype to avoid a caller-configured reserved key (e.g. `items: '__proto__'`)
  // writing to the envelope's prototype chain. JSON serialization is unaffected.
  const out = Object.create(null);
  out[items] = result.data;
  if (typeof result.offset === 'number') out[offset] = result.offset;
  out[limit] = result.limit;
  if (typeof result.total === 'number') out[total] = result.total;
  if (result.cursor) out[keys.cursor || 'cursor'] = result.cursor;
  if (options.links) {
    const linksKey = keys.links || 'links';
    out[linksKey] = options.links;
  }
  return out;
};
