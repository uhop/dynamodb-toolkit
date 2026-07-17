// @ts-self-types="./random.d.ts"
// Random string generator for unique suffixes.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export const random = (length = 8) => {
  let result = '';
  while (result.length < length) {
    const bytes = new Uint8Array(length - result.length);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      // rejection sampling: 252 = 7×36, higher bytes would bias the modulo
      if (b < 252) result += ALPHABET[b % 36];
    }
  }
  return result;
};
