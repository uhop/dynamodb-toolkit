import type {ArrayOp} from '../../expressions/update.js';

export interface ParsePatchOptions {
  metaPrefix?: string;
}

export interface ParsedPatch {
  patch: Record<string, unknown>;
  options: {
    delete?: string[];
    separator?: string;
    arrayOps?: ArrayOp[];
  };
}

export function parsePatch(body: Record<string, unknown> | null | undefined, options?: ParsePatchOptions): ParsedPatch;
