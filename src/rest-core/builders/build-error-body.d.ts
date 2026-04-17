/** Options for {@link buildErrorBody}. */
export interface BuildErrorBodyOptions {
  /** Echoed into the error body as `errorId`. */
  errorId?: string;
  /** When `true`, the `err.stack` is included in the response (dev only!). */
  includeDebug?: boolean;
}

/** Default error response shape. */
export interface ErrorBody {
  /** `err.code` or `err.name` — the SDK-level error class. */
  code: string;
  /** `err.message`. */
  message: string;
  /** Optional correlation ID, if supplied via options. */
  errorId?: string;
  /** Stack trace, if `includeDebug` was set. */
  stack?: string;
}

/**
 * Build a `{code, message}` error envelope. Extend via options when you want
 * to echo a correlation ID or include the stack trace.
 *
 * @param err The error to render.
 * @param options Optional `errorId` / `includeDebug`.
 */
export function buildErrorBody(err: unknown, options?: BuildErrorBodyOptions): ErrorBody;
