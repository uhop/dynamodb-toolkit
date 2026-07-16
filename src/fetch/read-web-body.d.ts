/**
 * Read a JSON body from a Fetch `Request`, enforcing a byte cap without
 * materializing the full payload first. Implements a Content-Length fast-path
 * reject plus a mid-stream byte counter so chunked requests are also capped.
 *
 * Errors are shaped to match the rest-core conventions:
 * - Oversize → `status: 413`, `code: 'PayloadTooLarge'`.
 * - Invalid JSON → `status: 400`, `code: 'BadJsonBody'`.
 *
 * @param request The Fetch `Request` whose body will be read.
 * @param maxBodyBytes Byte cap. Bodies at or below this cap are accepted.
 * @returns The parsed JSON value, or `null` when the request body is empty.
 */
export function readJsonBody(request: Request, maxBodyBytes: number): Promise<unknown>;
