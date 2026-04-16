import type {BatchDescriptor} from './adapter.js';

export type OpName = 'post' | 'put' | 'patch' | 'delete';

export interface AdapterHooks<TItem extends Record<string, unknown>> {
  prepare?: (item: TItem, isPatch?: boolean) => TItem;
  prepareKey?: (key: Partial<TItem>, index?: string) => Partial<TItem>;
  prepareListInput?: (example: Partial<TItem>, index?: string) => Record<string, unknown>;
  updateInput?: (input: Record<string, unknown>, op: {name: OpName; force?: boolean}) => Record<string, unknown>;
  revive?: (rawItem: TItem, fields?: string[]) => TItem;
  validateItem?: (item: TItem, isPatch?: boolean) => Promise<void>;
  checkConsistency?: (batch: BatchDescriptor) => Promise<BatchDescriptor[] | null>;
}

export const defaultHooks: Required<AdapterHooks<Record<string, unknown>>>;

export function restrictKey<T extends Record<string, unknown>>(rawKey: T, keyFields: string[]): Partial<T>;
