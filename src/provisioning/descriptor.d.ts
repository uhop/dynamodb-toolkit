import type {ProvisioningDeclaration} from './declaration.js';

/** Descriptor record schema version. Bump when the shape changes incompatibly. */
export const DESCRIPTOR_VERSION: 1;

/** JSON-serialisable snapshot of an adapter declaration. */
export interface DescriptorSnapshot {
  version: number;
  generatedAt: string;
  table: string;
  keyFields: Array<{name: string; type: string; width?: number}>;
  structuralKey: {name: string; separator: string} | null;
  indices: Record<
    string,
    {
      type: 'gsi' | 'lsi';
      pk?: {name: string; type: string};
      sk?: {name: string; type: string};
      projection: 'all' | 'keys-only' | string[];
      sparse: boolean | {onlyWhen: '<function>'};
      indirect: boolean;
    }
  >;
  typeLabels: string[] | null;
  typeDiscriminator: {name: string} | null;
  filterable: Record<string, string[]>;
  searchable: string[];
  searchablePrefix: string | null;
  versionField: string | null;
  createdAtField: string | null;
  technicalPrefix: string | null;
  relationships: {structural?: boolean} | null;
}

/** DB-shaped key for the descriptor record. */
export function descriptorRecordKey(decl: ProvisioningDeclaration): Record<string, string>;

/** Build a snapshot from the declaration (pure transform — no I/O). */
export function buildDescriptorSnapshot(decl: ProvisioningDeclaration): DescriptorSnapshot;

/** Read the descriptor record. Returns `null` when absent. */
export function readDescriptor(decl: ProvisioningDeclaration): Promise<DescriptorSnapshot | null>;

/** Overwrite the descriptor record with a fresh snapshot of the declaration. */
export function writeDescriptor(decl: ProvisioningDeclaration): Promise<DescriptorSnapshot>;

/** Diff a stored descriptor against the current declaration. */
export function compareDescriptor(
  stored: DescriptorSnapshot,
  decl: ProvisioningDeclaration
): Array<{path: string; severity: 'warn' | 'error'; expected: unknown; actual: unknown}>;
