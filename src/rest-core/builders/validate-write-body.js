// Validate a parsed JSON body for write-shaped routes (POST, PUT, PATCH).
//
// Write routes spread the body into the outbound item (`{...body, ...key}`).
// A non-object body would either silently drop fields (`null` → key-only
// row), or flow through array indices as object keys (`[1,2]` → `{0:1, 1:2}`).
// Both modes succeed today with surprising results. This helper rejects both
// at the rest-core boundary so the caller sees a clean 400.
//
// Pass-through shapes:
//   - plain objects (including `{}`) → returned as-is
//   - `null` / `undefined` → passed through ONLY when `allowEmpty` is set
//     (collection routes that accept empty bodies use this)
// Rejected shapes:
//   - arrays (except when `allowArray` is set — `PUT /-load` takes an array)
//   - primitives (string, number, boolean)
//   - non-null, non-array, non-object-literal values
//
// Throws `{status: 400, code: 'BadBody'}` on rejection so the adapter can
// surface a consistent error envelope.

export const validateWriteBody = (body, {allowEmpty = false, allowArray = false} = {}) => {
  if (body === null || body === undefined) {
    if (allowEmpty) return body;
    throw Object.assign(new Error('Request body is required'), {status: 400, code: 'BadBody'});
  }
  if (Array.isArray(body)) {
    if (allowArray) return body;
    throw Object.assign(new Error('Request body must be a JSON object, not an array'), {status: 400, code: 'BadBody'});
  }
  if (typeof body !== 'object') {
    throw Object.assign(new Error('Request body must be a JSON object'), {status: 400, code: 'BadBody'});
  }
  return body;
};
