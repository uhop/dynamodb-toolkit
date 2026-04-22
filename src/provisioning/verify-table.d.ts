import type {ProvisioningDeclaration} from './declaration.js';

/** One mismatch between declaration and live table / stored descriptor. */
export interface TableDiff {
  /**
   * Dotted path naming what differs. Examples: `'table'`, `'table.KeySchema'`,
   * `'gsi.by-foo'`, `'lsi.by-bar.Projection'`, `'descriptor.indices'`.
   */
  path: string;
  /** `'error'`: declared-vs-actual key/index mismatch. `'warn'`: extras or descriptor drift. */
  severity: 'error' | 'warn';
  expected: unknown;
  actual: unknown;
}

export interface VerifyTableResult {
  ok: boolean;
  diffs: TableDiff[];
}

export interface VerifyTableOptions {
  /** Throw {@link TableVerificationFailed} when any `error`-severity diff is present. */
  throwOnMismatch?: boolean;
  /** Require the reserved descriptor record. Missing descriptor becomes an `error`-severity diff. */
  requireDescriptor?: boolean;
}

/** Compare the declaration against the live table and optional descriptor. */
export function verifyTable(adapterOrDeclaration: unknown, options?: VerifyTableOptions): Promise<VerifyTableResult>;

/** Pure diff against DescribeTable output. No I/O. */
export function diffTable(decl: ProvisioningDeclaration, live: Record<string, unknown> | null): TableDiff[];
