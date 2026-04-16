// Parse offset/limit query values with sane defaults and a hard ceiling.
// Negative offset → 0; non-numeric → defaults; over-cap limit clamped to maxLimit.

export const parsePaging = (input = {}, options = {}) => {
  const defaultLimit = options.defaultLimit ?? 10;
  const maxLimit = options.maxLimit ?? 100;

  const rawOffset = input.offset;
  const rawLimit = input.limit;

  let offset = Number(rawOffset);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  let limit = Number(rawLimit);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(maxLimit, Math.max(1, Math.floor(limit)));

  return {offset, limit};
};
