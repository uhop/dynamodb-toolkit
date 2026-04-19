/**
 * Generator yielding exponential delays (with full jitter) for retry loops.
 * Defaults follow AWS guidance for DynamoDB retries: base `50ms`, per-retry cap
 * `20s`, matching the AWS SDK's default retry delay cap. Pair with a caller-side
 * attempt count so total wait stays around AWS's recommended ~60s ceiling.
 *
 * @param from Base delay in milliseconds. Default `50` (AWS DDB doc example).
 * @param to Maximum delay in milliseconds. Default `20000` (matches AWS SDK v3 default).
 * @param finite When `true`, the generator terminates after a fixed number
 *   of yields; when `false` (default), it yields forever (up to the cap) —
 *   always pair with an attempt cap to bound total wait.
 * @returns Generator whose yielded numbers are milliseconds to `await sleep(...)` before
 *   the next retry attempt — already jittered, ready to pass straight to `sleep`.
 */
export function backoff(from?: number, to?: number, finite?: boolean): Generator<number, void, unknown>;
