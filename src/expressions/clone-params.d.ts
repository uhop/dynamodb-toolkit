/**
 * Shallow-clone a DynamoDB params object, with fresh copies of its
 * `ExpressionAttributeNames` / `ExpressionAttributeValues` maps. Useful when
 * you want to apply builders without mutating the caller's params.
 */
export function cloneParams<T extends Record<string, unknown>>(params: T): T;
