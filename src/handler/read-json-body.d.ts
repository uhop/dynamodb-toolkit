export interface ReadJsonBodyOptions {
  /**
   * When `true` (default), call `req.destroy?.()` after rejecting with 413 so
   * the runtime releases the kernel socket buffer. Pass `false` from adapters
   * that need the socket alive to write the 413 response (Koa, Express).
   */
  destroy?: boolean;
}

/**
 * Read a JSON body from a Node-stream-shaped request with a byte-size cap.
 *
 * Measures `size` in bytes (off each `Buffer` chunk, not UTF-16 code units)
 * and streams each chunk through a `TextDecoder('utf-8')` so peak memory
 * stays ~1× body size and partial codepoints across chunk boundaries are
 * handled safely. Rejects mid-stream with
 * `{status: 413, code: 'PayloadTooLarge'}` when the cap is crossed; with
 * `{status: 400, code: 'BadJsonBody'}` when the accumulated text isn't valid
 * JSON.
 *
 * Empty body → `null`.
 *
 * @param req Node-stream-shaped request with `on('data' | 'end' | 'error')`.
 * @param maxBodyBytes Hard byte cap. Exceeded bodies yield 413.
 * @param options See {@link ReadJsonBodyOptions}.
 */
export function readJsonBody(
  req: {
    on(event: 'data', listener: (chunk: Buffer | Uint8Array | string) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
    destroy?(): void;
  },
  maxBodyBytes: number,
  options?: ReadJsonBodyOptions
): Promise<unknown>;
