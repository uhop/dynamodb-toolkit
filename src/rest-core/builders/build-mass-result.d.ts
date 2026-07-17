import type {MassOpResult} from '../../mass/index.js';

/** Wire body for a mass-operation response. */
export interface MassResultBody {
  /** Items successfully processed. */
  processed: number;
  /** Items skipped (condition semantics — e.g. `ifNotExists` re-rejects). Present only when non-zero. */
  skipped?: number;
  /** Per-item failures. Present only when non-empty. */
  failed?: MassOpResult['failed'];
  /** Per-item conflicts. Present only when non-empty. */
  conflicts?: MassOpResult['conflicts'];
  /** Opaque resume token — present when the op stopped at `max-items`. Pass back via `?resume=`. */
  cursor?: string;
}

/**
 * Build the wire body for a mass-operation result. Additive over the
 * historical `{processed: N}` shape: `skipped` / `failed` / `conflicts` /
 * `cursor` appear only when present.
 *
 * @param r A mass-op result (`{processed}` at minimum).
 * @returns The response body.
 */
export function buildMassResult(r: Partial<MassOpResult> | {processed: number}): MassResultBody;
