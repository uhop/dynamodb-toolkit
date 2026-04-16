export function addProjection<T extends Record<string, unknown>>(
  params: T,
  fields?: string | string[] | Record<string, unknown> | null,
  projectionFieldMap?: Record<string, string>,
  skipSelect?: boolean,
  separator?: string
): T;
