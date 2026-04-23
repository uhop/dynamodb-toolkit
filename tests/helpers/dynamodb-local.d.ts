/**
 * Discriminated return type of {@link startDynamoDBLocal}.
 * - `skip: true` — Docker unavailable; caller should skip tests.
 * - `skip: false` — a live DynamoDB Local container; `endpoint` is the
 *   URL to pass to the SDK, `stop()` tears it down.
 */
export type StartDynamoDBLocalResult =
  | {skip: true; reason: string}
  | {skip: false; endpoint: string; port: number; stop: () => Promise<void>};

/**
 * Spawn the `amazon/dynamodb-local` Docker container on a random port.
 * Returns `{skip: true, reason}` when Docker is unavailable so tests
 * can short-circuit gracefully.
 */
export function startDynamoDBLocal(): Promise<StartDynamoDBLocalResult>;
