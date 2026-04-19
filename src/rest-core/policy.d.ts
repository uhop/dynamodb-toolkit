import type {EnvelopeKeys} from './builders/build-envelope.js';
import type {ErrorBody, BuildErrorBodyOptions} from './builders/build-error-body.js';

/** HTTP status codes emitted by the handler. Override per policy. */
export interface RestStatusCodes {
  /** Single-item miss. Default `404`. */
  miss: number;
  /** Input validation failure (e.g. `ValidationException`). Default `422`. */
  validation: number;
  /** Consistency failure (e.g. `ConditionalCheckFailedException`). Default `409`. */
  consistency: number;
  /** Throttling / throughput exceeded. Default `429`. */
  throttle: number;
  /** Transient SDK / network failure. Default `503`. */
  transient: number;
  /** Anything else. Default `500`. */
  internal: number;
}

/** Full REST policy. Override subsets via {@link mergePolicy}. */
export interface RestPolicy {
  /** Meta-key prefix on patch bodies. Default `'_'`. */
  metaPrefix: string;
  /** DB-internal field prefix (informational; not enforced). Default `'-'`. */
  dbPrefix: string;
  /** URL prefix for method routes (`/-by-names`, `/-clone`). Default `'-'`. */
  methodPrefix: string;
  /** Envelope key name overrides. */
  envelope: Required<EnvelopeKeys>;
  /** HTTP status code mapping. */
  statusCodes: RestStatusCodes;
  /**
   * Builder that turns an error into the response body sent to the client.
   * Swap for a custom envelope (e.g. to match your API's error schema).
   *
   * - `err` — the error being mapped, after it's already been bucketed by
   *   {@link mapErrorStatus}. `unknown` in the signature; in practice an
   *   `Error`-like object with `.name`, `.message`, and optional
   *   `.$metadata`.
   * - `options` — `{includeDebug?, errorId?}`. `includeDebug: true` asks
   *   the builder to append the stack; `errorId` is a correlation ID the
   *   handler may have generated for logging.
   *
   * Return the JSON-serializable body. The default builder returns
   * `{code, message}` (plus `stack` when `includeDebug`, plus `errorId`
   * when supplied). Replace with your own function to match your API
   * convention — e.g. a `{error: {type, message, requestId}}` envelope.
   */
  errorBody: (err: unknown, options?: BuildErrorBodyOptions) => ErrorBody;
  /** When `false`, list endpoints omit `total` and skip the COUNT round-trip. Default `true`. */
  needTotal: boolean;
  /** Default `?limit=` when the client doesn't supply one. Default `10`. */
  defaultLimit: number;
  /** Ceiling on `?limit=` — larger values are clamped. Default `100`. */
  maxLimit: number;
  /**
   * Ceiling on `?offset=` — larger values are clamped. Default `100_000`.
   * Prevents DoS via `?offset=1e15` which would otherwise drive `paginateList`
   * into astronomical skip-page SDK calls.
   */
  maxOffset: number;
}

/** The default REST policy. Inspect for the baseline values. */
export const defaultPolicy: RestPolicy;

/**
 * Map an SDK error to an HTTP status code per the policy's `statusCodes`.
 * Recognized names: `ConditionalCheckFailedException`,
 * `TransactionCanceledException`, `TransactionConflictException` → consistency;
 * `ValidationException` / `ValidationError` → validation;
 * `ProvisionedThroughputExceededException` / `RequestLimitExceeded` → throttle;
 * 5xx SDK errors → transient; everything else → internal.
 *
 * @param err The error to classify.
 * @param statusCodes Status-code map. Falls back to {@link defaultPolicy}.
 * @returns The HTTP status code to send — one of the policy's `statusCodes` values.
 */
export function mapErrorStatus(err: unknown, statusCodes?: RestStatusCodes): number;

/**
 * Deep-merge a partial policy with {@link defaultPolicy}. `envelope` and
 * `statusCodes` are merged key-by-key; everything else is shallow-merged.
 *
 * @param overrides Partial policy to overlay.
 * @returns A fully-populated policy — pass directly to `createHandler`'s `policy` option.
 */
export function mergePolicy(overrides?: Partial<RestPolicy>): RestPolicy;
