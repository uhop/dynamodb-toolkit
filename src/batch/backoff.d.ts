/**
 * Generator yielding exponential delays (with full jitter) for retry loops.
 *
 * @param from Base delay in milliseconds. Default `50`.
 * @param to Maximum delay in milliseconds. Default `2000`.
 * @param finite When `true`, the generator terminates after a fixed number
 *   of yields; when `false` (default), it yields forever (up to the cap).
 */
export function backoff(from?: number, to?: number, finite?: boolean): Generator<number, void, unknown>;
