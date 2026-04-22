/**
 * Structured cursor payload. Callers treat the encoded string as opaque;
 * this interface is exposed only so `decodeCursor` has a return type in
 * debug/test contexts. The field set is intentionally extensible — new
 * mass ops may add their own bookkeeping keys.
 */
export interface CursorPayload {
  /** DynamoDB `LastEvaluatedKey` from the most recent page. */
  LastEvaluatedKey?: Record<string, unknown>;
  /** Mass-op identifier, e.g., `'copy'`, `'move'`, `'delete'`, `'edit'`. */
  op?: string;
  /** Macro phase — e.g., `'put'` or `'delete'` in `rename`. */
  phase?: string;
  /** Op-specific bookkeeping (item counts, per-phase LEKs, etc.). */
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Encode a cursor payload to an opaque base64url string.
 *
 * Throws `TypeError` if `payload` is not an object. Callers should treat
 * the returned string as opaque and pass it back in via the `resumeToken`
 * option on a subsequent mass-op call.
 */
export function encodeCursor(payload: CursorPayload): string;

/**
 * Decode an opaque cursor string back to its structured payload.
 *
 * Debug / test helper only — the inner shape is not a stable public
 * contract and may change in minor releases. Throws `TypeError` on empty
 * or non-string input, and bubbles up any `JSON.parse` error for
 * malformed cursors.
 */
export function decodeCursor(cursor: string): CursorPayload;
