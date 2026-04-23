import type {ProvisioningDeclaration} from './declaration.js';

/** One step in an ensureTable plan. */
export type PlanStep =
  | {action: 'create'; params: Record<string, unknown>}
  | {action: 'add-gsi'; name: string; params: Record<string, unknown>}
  | {action: 'skip-extra-gsi'; name: string}
  | {action: 'skip-extra-lsi'; name: string}
  | {action: 'skip-missing-lsi'; name: string};

/** Result of {@link planTable}: steps the toolkit would take, plus plain-text summary. */
export interface EnsureTablePlan {
  tableName: string;
  steps: PlanStep[];
  /** Human-readable lines — print for display or CLI output. */
  summary: string[];
}

/** Result of {@link ensureTable}: the computed plan plus execution state. */
export interface EnsureTableResult {
  plan: EnsureTablePlan;
  /** Ordered list of `create:<table>` / `add-gsi:<name>` step IDs. */
  executed: string[];
  /** `true` when `descriptorKey` is declared and the descriptor record was written. */
  descriptorWritten?: boolean;
}

/**
 * Read-only: compute the ADD-only plan for this adapter's declaration
 * vs. the live table. Never writes. Returns `{tableName, steps, summary}`.
 * For the execute-plus-apply path, call {@link ensureTable} instead.
 */
export function planTable(adapterOrDeclaration: unknown): Promise<EnsureTablePlan>;

/**
 * Compute the plan (via {@link planTable}) and execute it. ADD-only —
 * never drops tables or indices. Writes the descriptor record when
 * `descriptorKey` is declared. Returns `{plan, executed, descriptorWritten?}`.
 * For the read-only view, call {@link planTable}.
 */
export function ensureTable(adapterOrDeclaration: unknown): Promise<EnsureTableResult>;

export function buildCreateTableInput(decl: ProvisioningDeclaration): Record<string, unknown>;
export function buildAddGsiInput(
  decl: ProvisioningDeclaration,
  name: string,
  idx: NonNullable<ProvisioningDeclaration['indices']>[string]
): Record<string, unknown>;
export function planAddOnly(decl: ProvisioningDeclaration, describeOutput: Record<string, unknown> | null): EnsureTablePlan;
export function describeTable(client: ProvisioningDeclaration['client'], tableName: string): Promise<Record<string, unknown> | null>;
export function executePlan(client: ProvisioningDeclaration['client'], plan: EnsureTablePlan): Promise<{executed: string[]}>;
