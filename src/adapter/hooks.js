// Default Adapter hook implementations. All identity-shaped except revive (subsetObject).

import {subsetObject} from '../paths/subset-object.js';

const identity = x => x;

const restrictKey = (rawKey, keyFields) =>
  keyFields.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(rawKey, key)) acc[key] = rawKey[key];
    return acc;
  }, {});

export const defaultHooks = {
  prepare: identity,
  prepareKey: (key, _index, _ctx) => key,
  prepareListInput: () => ({}),
  updateInput: input => input,
  revive: (rawItem, fields) => (fields ? subsetObject(rawItem, fields) : rawItem),
  validateItem: async () => {},
  checkConsistency: async () => null
};

export {restrictKey};
