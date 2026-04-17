/**
 * Read a nested value by dotted path. Pure-digit segments become array indices.
 *
 * @param o Object (or array) to read from.
 * @param path Dotted path (e.g. `'a.b.0'`) or pre-split segment array.
 * @param defaultValue Returned when any intermediate segment is missing. Default `undefined`.
 * @param separator Path separator. Default `'.'`.
 */
export function getPath(o: unknown, path: string | string[], defaultValue?: unknown, separator?: string): unknown;
