/**
 * Remove unused entries from `ExpressionAttributeNames` and
 * `ExpressionAttributeValues` — anything no expression string actually
 * references. DynamoDB rejects calls with unused placeholders; run this
 * after composing multiple builders into the same params object. Mutates
 * and returns `params`.
 */
export function cleanParams<T extends Record<string, unknown>>(params: T): T;
