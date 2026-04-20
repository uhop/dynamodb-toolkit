export interface ValidateWriteBodyOptions {
  /** Allow `null` / `undefined` bodies to pass through. Default `false`. */
  allowEmpty?: boolean;
  /** Allow array bodies to pass through (e.g. for `/-load` routes). Default `false`. */
  allowArray?: boolean;
}

/**
 * Validate a parsed JSON body for write-shaped routes. Rejects non-object,
 * non-null, non-array bodies — or arrays/null without the matching option —
 * with a `{status: 400, code: 'BadBody'}` error so callers see a consistent
 * envelope instead of silently accepting `{...null}` or `{...[1,2]}`.
 *
 * @param body Parsed body (from `readJsonBody` or framework body parser).
 * @param options Toggle `allowEmpty` / `allowArray` per route.
 * @returns The body unchanged when it passes validation.
 */
export function validateWriteBody(body: unknown, options?: ValidateWriteBodyOptions): unknown;
