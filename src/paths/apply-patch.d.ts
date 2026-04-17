/** Options for {@link applyPatch}. */
export interface ApplyPatchOptions {
  /** Paths to delete after writes have been applied. */
  delete?: string[];
  /** Path separator. Default `'.'`. */
  separator?: string;
}

/**
 * Apply a flat patch object to an in-memory item using {@link setPath} for each
 * key, plus {@link deletePath} for every entry in `options.delete`. Mirrors
 * what DynamoDB's `UpdateExpression` does — useful for optimistic UI or
 * client-side preview of pending updates. Mutates `o` and returns it.
 *
 * @param o Object to patch in place.
 * @param patch Flat object whose keys are dotted paths.
 * @param options Deletion paths and separator override.
 * @returns The same `o`, mutated — useful for chaining.
 */
export function applyPatch<T extends Record<string, unknown>>(o: T, patch: Record<string, unknown>, options?: ApplyPatchOptions): T;
