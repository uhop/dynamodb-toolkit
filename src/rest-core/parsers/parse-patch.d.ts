import type {ArrayOp} from '../../expressions/update.js';

/** Options for {@link parsePatch}. */
export interface ParsePatchOptions {
  /** Prefix identifying meta keys on the wire. Default `'_'`. */
  metaPrefix?: string;
}

/** Return shape of {@link parsePatch}. */
export interface ParsedPatch {
  /** User-field patch — everything without the meta prefix. */
  patch: Record<string, unknown>;
  /** Meta options — feed directly to `buildUpdate` / `Adapter.patch`. */
  options: {
    /** Paths to REMOVE (from `<prefix>delete`). */
    delete?: string[];
    /** Path separator override (from `<prefix>separator`). */
    separator?: string;
    /** Atomic array ops (from `<prefix>arrayOps`). */
    arrayOps?: ArrayOp[];
  };
}

/**
 * Split a wire-format patch body into a plain patch object plus
 * `PatchOptions`. Recognized meta keys (after `metaPrefix`): `delete`,
 * `separator`, `arrayOps`. Unknown meta keys are silently dropped.
 *
 * @param body Raw request body. Non-objects and `null` are treated as empty.
 * @param options Meta prefix override.
 * @returns `{patch, options}` — user fields split from meta; pass `options` straight to
 *   `Adapter.patch` / `buildUpdate`. `patch` is empty when the body was empty or non-object.
 */
export function parsePatch(body: Record<string, unknown> | null | undefined, options?: ParsePatchOptions): ParsedPatch;
