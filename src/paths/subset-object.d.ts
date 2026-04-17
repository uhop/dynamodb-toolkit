/**
 * Return a new object containing only the requested fields/paths. Missing
 * fields are silently omitted (no `undefined` keys in the result). Supports
 * nested paths — `subsetObject({a: {x: 1, y: 2}}, ['a.x'])` returns `{a: {x: 1}}`.
 *
 * @param o Source object.
 * @param fields Field spec in any form {@link normalizeFields} accepts. When
 *   `null` or omitted, returns `o` unchanged.
 * @param separator Path separator. Default `'.'`.
 */
export function subsetObject<T extends Record<string, unknown>>(
  o: T,
  fields?: string | string[] | Record<string, unknown> | null,
  separator?: string
): Partial<T>;
