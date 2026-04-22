import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import type {MassOpOptions, MassOpResult, MassOpFailure, MassOpConflict} from './index.js';

/**
 * Partial envelope returned by a per-page handler. Only counts /
 * failures attributable to the items on that page.
 */
export interface PageResult {
  processed?: number;
  skipped?: number;
  failed?: MassOpFailure[];
  conflicts?: MassOpConflict[];
}

/**
 * Per-page handler invoked once per fetched page of items. Receives the
 * items as returned by the SDK (raw — `runPaged` does not revive) and
 * any `meta` bookkeeping from the resumed cursor. Must not throw on
 * per-item failures; bucket them into `failed` / `conflicts` instead.
 */
export type OnPage = (items: Record<string, unknown>[], meta?: Record<string, unknown>) => Promise<PageResult | void> | PageResult | void;

/**
 * Walk a `Query` / `Scan` result page by page, accumulating a
 * `MassOpResult` envelope. Stops at a page boundary once
 * `options.maxItems` is reached (soft cap — no mid-page splits), and
 * emits a cursor for the next call. Returns without a cursor when the
 * scan is exhausted.
 *
 * Re-entry via `options.resumeToken` restarts from the last-completed
 * page's `LastEvaluatedKey` — items in prior pages are not re-fetched.
 */
export function runPaged(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  options: MassOpOptions | undefined,
  onPage: OnPage
): Promise<MassOpResult>;
