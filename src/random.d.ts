/**
 * Generate a random lowercase alphanumeric string — useful for unique suffixes
 * (test table names, scratch keys, idempotency tokens). Uses `crypto.getRandomValues`.
 *
 * @param length Desired string length. Default `8`.
 */
export function random(length?: number): string;
