/**
 * Monotonic counter — returns a new integer (`1`, `2`, `3`, …) on every call.
 * Process-wide state; resets only on process restart.
 *
 * @returns The next sequence number — unique within the current process, strictly
 *   greater than the previous call's return value. Handy for correlation IDs or
 *   placeholder aliasing inside a single request.
 */
export function seq(): number;
