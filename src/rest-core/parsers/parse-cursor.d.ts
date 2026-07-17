/**
 * Validate an opaque cursor / resume token from a query parameter.
 *
 * Returns the token string when it decodes cleanly, `undefined` when the
 * input is missing / empty, and throws a 400-shaped error (`status: 400`,
 * `code: 'BadCursor'`) when the token is malformed or carries an
 * unsupported cursor version — wire input is untrusted, so validation
 * happens at the boundary.
 *
 * @param input Raw query value.
 * @param name Parameter name used in the error message. Default `'cursor'`.
 * @returns The validated opaque token, or `undefined` when absent.
 */
export function parseCursor(input: unknown, name?: string): string | undefined;
