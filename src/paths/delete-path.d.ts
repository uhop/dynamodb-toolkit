/**
 * Delete the leaf at a nested path. Mutates `o` in place. Leaves intermediate
 * containers intact. Silently no-ops when the path is missing.
 *
 * @param o Object to mutate.
 * @param path Dotted path (e.g. `'a.b.0'`) or pre-split segment array.
 * @param separator Path separator. Default `'.'`.
 * @returns `true` if something was removed, `false` otherwise.
 */
export function deletePath(o: Record<string, unknown>, path: string | string[], separator?: string): boolean;
