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

/**
 * Retry policy for chunked batch I/O (`BatchWriteItem` / `BatchGetItem`) —
 * controls the delay schedule and attempt cap of the `UnprocessedItems` /
 * `UnprocessedKeys` resubmit loop. Accepted per call via an
 * `{options: {retry}}` sentinel on `applyBatch` / `getBatch`, as the trailing
 * `retry` argument on the `mass` helpers, per Adapter via the constructor's
 * `retry` option, and per Adapter call via `options.retry`.
 */
export interface RetryOptions {
  /**
   * Factory producing per-attempt delays in milliseconds — invoked once per
   * chunk. Default: `backoff()` (exponential, full jitter, base 50 ms, cap
   * 20 s). A finite iterable bounds the loop by itself: if it runs dry while
   * work is still pending, the operation throws.
   */
  backoff?: () => Iterable<number>;
  /**
   * Attempt cap before throwing. Default `8` — ≈43 s max total wait with the
   * default backoff, matching AWS's "stop around one minute" guidance.
   */
  maxAttempts?: number;
}
