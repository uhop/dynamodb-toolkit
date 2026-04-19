// Apply a patch object to a target, with optional delete paths.

import {setPath} from './set-path.js';
import {deletePath} from './delete-path.js';

export const applyPatch = (o, patch, options) => {
  const separator = options?.separator || '.';
  if (Array.isArray(options?.delete)) {
    for (const path of options.delete) {
      deletePath(o, path, separator);
    }
  }
  if (!patch) return o;
  for (const path of Object.keys(patch)) {
    setPath(o, path, patch[path], separator);
  }
  return o;
};
