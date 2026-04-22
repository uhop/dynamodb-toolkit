// Map ↔ plain-object marshalling for DynamoDB's M (map) attribute type.
// The DocumentClient accepts plain `{}`; `Map` instances are not
// converted automatically. Apps that use `Map` in-memory for explicit
// key ordering or runtime-only key semantics need this shim.
//
// `valueTransform` lets you nest — e.g., `marshallMap(prices, marshallDateISO)`
// when values are Dates and the outer shape is keyed.

const identity = x => x;

export const marshallMap = (map, valueTransform = identity) => {
  if (map === undefined || map === null) return map;
  if (!(map instanceof Map)) throw new TypeError('marshallMap: expected Map');
  const out = {};
  for (const [k, v] of map) {
    if (typeof k !== 'string') throw new TypeError('marshallMap: keys must be strings (DynamoDB M keys are strings)');
    out[k] = valueTransform(v);
  }
  return out;
};

export const unmarshallMap = (obj, valueTransform = identity) => {
  if (obj === undefined || obj === null) return obj;
  if (typeof obj !== 'object') throw new TypeError('unmarshallMap: expected plain object');
  const out = new Map();
  // Object.keys returns only own enumerable string keys — hostile
  // `__proto__` pollution from storage won't leak into the Map (Map's
  // internal storage is separate from Object's prototype chain anyway,
  // but we're explicit).
  for (const k of Object.keys(obj)) out.set(k, valueTransform(obj[k]));
  return out;
};
