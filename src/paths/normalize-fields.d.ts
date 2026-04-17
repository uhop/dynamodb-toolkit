/**
 * Coerce a field specification into `string[] | null`. Applies a first-segment
 * alias map to every path if supplied.
 *
 * Accepts:
 * - `'name,climate'` — comma-separated string
 * - `['name', 'climate']` — array
 * - `{name: 1, climate: 1}` — object whose keys are taken
 * - `null` / `undefined` / `''` — returns `null`
 *
 * @param fields Field spec in any supported form.
 * @param projectionFieldMap Optional alias map for the first segment of each path.
 * @param separator Path separator. Default `'.'`.
 */
export function normalizeFields(
  fields: string | string[] | Record<string, unknown> | null | undefined,
  projectionFieldMap?: Record<string, string>,
  separator?: string
): string[] | null;
