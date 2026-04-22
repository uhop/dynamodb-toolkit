import type {ProvisioningDeclaration} from './declaration.js';

/** One step in an ensureTable plan. */
export type PlanStep =
  | {action: 'create'; params: Record<string, unknown>}
  | {action: 'add-gsi'; name: string; params: Record<string, unknown>}
  | {action: 'skip-extra-gsi'; name: string}
  | {action: 'skip-extra-lsi'; name: string}
  | {action: 'skip-missing-lsi'; name: string};

/** Result of planning: steps the toolkit would take, plus plain-text summary. */
export interface EnsureTablePlan {
  tableName: string;
  steps: PlanStep[];
  /** Human-readable lines — print for dry-run output. */
  summary: string[];
}

/** Result of executing a plan. */
export interface EnsureTableResult {
  plan: EnsureTablePlan;
  /** Ordered list of `create:<table>` / `add-gsi:<name>` step IDs. */
  executed: string[];
  /** `true` when `descriptorKey` is declared and the descriptor record was written. */
  descriptorWritten?: boolean;
}

/** Options for {@link ensureTable}. */
export interface EnsureTableOptions {
  /** Execute the plan. Without this flag, the function returns the plan and writes nothing. */
  yes?: boolean;
  /** Explicit plan-only (same behaviour as omitting `yes`; documented for clarity). */
  dryRun?: boolean;
}

/**
 * Ensure the DynamoDB table exists and matches the declared index shape.
 * ADD-only — never drops tables or indices. Default returns the plan;
 * pass `{yes: true}` to execute.
 */
export function ensureTable(adapterOrDeclaration: unknown, options?: EnsureTableOptions): Promise<EnsureTablePlan | EnsureTableResult>;

export function buildCreateTableInput(decl: ProvisioningDeclaration): Record<string, unknown>;
export function buildAddGsiInput(
  decl: ProvisioningDeclaration,
  name: string,
  idx: NonNullable<ProvisioningDeclaration['indices']>[string]
): Record<string, unknown>;
export function planAddOnly(decl: ProvisioningDeclaration, describeOutput: Record<string, unknown> | null): EnsureTablePlan;
export function describeTable(client: ProvisioningDeclaration['client'], tableName: string): Promise<Record<string, unknown> | null>;
export function executePlan(client: ProvisioningDeclaration['client'], plan: EnsureTablePlan): Promise<{executed: string[]}>;
