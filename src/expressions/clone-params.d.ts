/**
 * Shallow-clone a DynamoDB params object, with fresh copies of its
 * `ExpressionAttributeNames` / `ExpressionAttributeValues` maps. Useful when
 * you want to apply builders without mutating the caller's params.
 *
 * @param params DynamoDB params to clone.
 * @returns A new object with the same top-level fields as `params`, plus fresh
 *   copies of the name/value placeholder maps — top-level mutations won't leak back.
 */
export function cloneParams<T extends Record<string, unknown>>(params: T): T;
