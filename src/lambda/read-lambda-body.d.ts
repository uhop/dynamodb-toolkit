/**
 * Decode a Lambda event body into a JS value.
 *
 * Lambda bodies are `string | null | undefined`, optionally base64-encoded
 * (indicated by `event.isBase64Encoded`). This function handles both cases,
 * enforces a byte-length cap, and parses the resulting UTF-8 text as JSON.
 *
 * Errors are shaped to match the rest-core conventions:
 * - Oversize → `status: 413`, `code: 'PayloadTooLarge'`.
 * - Invalid JSON → `status: 400`, `code: 'BadJsonBody'`.
 *
 * @param body The event body — `event.body` from a Lambda trigger.
 * @param isBase64Encoded `true` when the body string is base64-encoded (common
 *   on ALB, API Gateway with binary-media-types, and binary payloads).
 * @param maxBodyBytes Byte cap. Bodies at or below this cap are accepted.
 * @returns The parsed JSON value, or `null` when the body is empty.
 */
export function readJsonBody(body: string | null | undefined, isBase64Encoded: boolean | undefined, maxBodyBytes: number): unknown;
