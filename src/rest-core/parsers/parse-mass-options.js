// @ts-self-types="./parse-mass-options.d.ts"
// Parse mass-op wire options: `?max-items=N` (soft per-request cap, page
// boundary enforced) and `?resume=<token>` (opaque cursor from a prior
// response). Ignores absent / invalid values — the caps are opt-in.

import {parseCursor} from './parse-cursor.js';

export const parseMassOptions = (query = {}) => {
  const out = {};
  const maxItems = Number(query['max-items']);
  if (Number.isFinite(maxItems) && maxItems > 0) out.maxItems = Math.floor(maxItems);
  const resumeToken = parseCursor(query.resume, 'resume');
  if (resumeToken) out.resumeToken = resumeToken;
  return out;
};
