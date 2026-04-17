/**
 * Set a nested value by dotted path. Mutates `o` in place and returns it.
 * Intermediate containers are created as needed — objects for non-numeric
 * segments, arrays for numeric segments.
 *
 * @param o Object to mutate.
 * @param path Dotted path (e.g. `'a.b.0'`) or pre-split segment array.
 * @param value Value to write at the target.
 * @param separator Path separator. Default `'.'`.
 * @returns The same `o`, mutated — useful for chaining.
 */
export function setPath(o: Record<string, unknown>, path: string | string[], value: unknown, separator?: string): unknown;
