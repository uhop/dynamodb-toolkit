/**
 * Path helpers — nested access and patch application on plain JS objects.
 * Pure functions; no DynamoDB involvement. JSDoc lives on each re-exported symbol.
 */

export {getPath} from './get-path.js';
export {setPath} from './set-path.js';
export {deletePath} from './delete-path.js';
export {applyPatch, type ApplyPatchOptions} from './apply-patch.js';
export {normalizeFields} from './normalize-fields.js';
export {subsetObject} from './subset-object.js';
