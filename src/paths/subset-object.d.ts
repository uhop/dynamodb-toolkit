export function subsetObject<T extends Record<string, unknown>>(
  o: T,
  fields?: string | string[] | Record<string, unknown> | null,
  separator?: string
): Partial<T>;
