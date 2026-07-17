// @ts-self-types="./build-mass-result.d.ts"
// Build the wire body for a mass-operation result. Additive over the
// historical `{processed: N}` shape: skipped / failed / conflicts / cursor
// appear only when present, so unaffected consumers see no change.

export const buildMassResult = r => {
  const out = {processed: r?.processed ?? 0};
  if (r?.skipped) out.skipped = r.skipped;
  if (r?.failed?.length) out.failed = r.failed;
  if (r?.conflicts?.length) out.conflicts = r.conflicts;
  if (r?.cursor) out.cursor = r.cursor;
  return out;
};
