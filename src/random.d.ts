/**
 * Generate a random lowercase alphanumeric string — useful for unique suffixes
 * (test table names, scratch keys, idempotency tokens). Uses `crypto.getRandomValues`.
 *
 * @param length Desired string length. Default `8`.
 * @returns A fresh random string of exactly `length` characters, drawn from
 *   `[a-z0-9]`. Not cryptographically strong for secrets — it's a unique-enough tag.
 */
export function random(length?: number): string;
