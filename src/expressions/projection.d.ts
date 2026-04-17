/**
 * Add a `ProjectionExpression` to a DynamoDB params object. Handles
 * de-duplication, dotted-path aliasing, and reuse of existing
 * `ExpressionAttributeNames`. Mutates and returns `params`.
 *
 * @param params Existing DynamoDB params to extend.
 * @param fields Field spec in any form {@link normalizeFields} accepts.
 *   When `null` / omitted / empty, `params` is returned unchanged.
 * @param projectionFieldMap Alias map applied to the first segment of each path.
 * @param skipSelect When `true`, does not set `Select: 'SPECIFIC_ATTRIBUTES'`.
 *   Use when building params for a `Select: 'COUNT'` path.
 * @param separator Path separator. Default `'.'`.
 * @returns The same `params`, now carrying a `ProjectionExpression` (and `Select`
 *   unless `skipSelect` was set) — unchanged if `fields` was empty.
 */
export function addProjection<T extends Record<string, unknown>>(
  params: T,
  fields?: string | string[] | Record<string, unknown> | null,
  projectionFieldMap?: Record<string, string>,
  skipSelect?: boolean,
  separator?: string
): T;
