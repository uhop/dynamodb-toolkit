// Random string generator for unique suffixes.

export const random = (length = 8) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, length);
};
