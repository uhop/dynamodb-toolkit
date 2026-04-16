// Parse a truthy query flag: 'yes', 'true', '1', 'on' (case-insensitive) → true; everything else → false.

const positive = new Set(['yes', 'true', '1', 'on']);

export const parseFlag = input => {
  if (input == null) return false;
  if (typeof input === 'boolean') return input;
  return positive.has(String(input).toLowerCase());
};
