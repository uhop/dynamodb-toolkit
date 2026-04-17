/**
 * Monotonic counter — returns a new integer (`1`, `2`, `3`, …) on every call.
 * Process-wide state; resets only on process restart.
 */
export function seq(): number;
