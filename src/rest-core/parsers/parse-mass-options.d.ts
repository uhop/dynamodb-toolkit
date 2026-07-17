/** Wire-parsed mass-operation options. */
export interface MassWireOptions {
  /** Soft cap on items processed this request (page-boundary enforced). From `?max-items=N`. */
  maxItems?: number;
  /** Opaque resume token from a prior response's `cursor`. From `?resume=<token>`. */
  resumeToken?: string;
}

/**
 * Parse mass-op wire options from a query map: `?max-items=N` and
 * `?resume=<token>`. Absent / non-positive `max-items` is ignored; a
 * malformed `resume` token throws a 400-shaped error (`code: 'BadCursor'`)
 * via `parseCursor`.
 *
 * @param query Flat query map.
 * @returns Options ready to pass to the adapter's mass list methods.
 */
export function parseMassOptions(query?: Record<string, unknown>): MassWireOptions;
