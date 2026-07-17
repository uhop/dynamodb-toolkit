// @ts-self-types="./parse-cursor.d.ts"
// Validate an opaque cursor / resume token off the wire. The token is
// attacker-controlled: decode it here so a malformed value surfaces as a
// 400 at the boundary instead of a 500 from JSON.parse deep in a mass op.

import {decodeCursor} from '../../mass/cursor.js';

export const parseCursor = (input, name = 'cursor') => {
  if (input == null || input === '') return undefined;
  const value = String(input);
  try {
    decodeCursor(value);
  } catch {
    throw Object.assign(new Error(`Invalid '${name}' parameter: not a cursor issued by this API`), {
      status: 400,
      code: 'BadCursor'
    });
  }
  return value;
};
