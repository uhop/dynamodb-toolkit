// Parse offset/limit query values with sane defaults and a hard ceiling.
// Negative offset → 0; non-numeric → defaults; over-cap limit clamped to maxLimit.
// Offset is capped to `maxOffset` (default 100_000) to prevent DoS via ?offset=1e15
// which would otherwise drive paginateList into ~10^14 SDK calls skipping toward infinity.

export const parsePaging = (input = {}, options = {}) => {
  const defaultLimit = options.defaultLimit ?? 10;
  const maxLimit = options.maxLimit ?? 100;
  const maxOffset = options.maxOffset ?? 100_000;

  const rawOffset = input.offset;
  const rawLimit = input.limit;

  let offset = Number(rawOffset);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.min(maxOffset, Math.floor(offset));

  let limit = Number(rawLimit);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(maxLimit, Math.max(1, Math.floor(limit)));

  return {offset, limit};
};
