export interface ApplyPatchOptions {
  delete?: string[];
  separator?: string;
}

export function applyPatch<T extends Record<string, unknown>>(o: T, patch: Record<string, unknown>, options?: ApplyPatchOptions): T;
