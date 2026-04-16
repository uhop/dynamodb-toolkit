export function normalizeFields(
  fields: string | string[] | Record<string, unknown> | null | undefined,
  projectionFieldMap?: Record<string, string>,
  separator?: string
): string[] | null;
