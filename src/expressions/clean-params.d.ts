/**
 * Remove unused entries from `ExpressionAttributeNames` and
 * `ExpressionAttributeValues` — anything no expression string actually
 * references. DynamoDB rejects calls with unused placeholders; run this
 * after composing multiple builders into the same params object. Mutates
 * and returns `params`.
 *
 * @param params DynamoDB params to trim in place.
 * @returns The same `params`, with unreferenced `ExpressionAttributeNames` /
 *   `ExpressionAttributeValues` entries stripped; empty maps are deleted entirely.
 */
export function cleanParams<T extends Record<string, unknown>>(params: T): T;
