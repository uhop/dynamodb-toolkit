import type {DynamoDBDocumentClient, GetCommandInput, PutCommandInput, UpdateCommandInput, DeleteCommandInput} from '@aws-sdk/lib-dynamodb';

import type {Raw} from '../raw.js';
import type {ArrayOp} from '../expressions/update.js';
import type {ConditionClause} from '../expressions/condition.js';
import type {PaginatedResult} from '../mass/paginate-list.js';
import type {AdapterHooks} from './hooks.js';

export interface AdapterOptions<TItem extends Record<string, unknown>, _TKey = Partial<TItem>> {
  client: DynamoDBDocumentClient;
  table: string;
  keyFields: (keyof TItem & string)[];
  projectionFieldMap?: Record<string, string>;
  searchable?: Record<string, 1 | true>;
  searchablePrefix?: string;
  indirectIndices?: Record<string, 1 | true>;
  hooks?: AdapterHooks<TItem>;
}

export interface GetOptions {
  consistent?: boolean;
  reviveItems?: boolean;
  ignoreIndirection?: boolean;
  params?: Record<string, unknown>;
}

export interface PutOptions {
  force?: boolean;
  conditions?: ConditionClause[];
  params?: Record<string, unknown>;
}

export interface PatchOptions {
  delete?: string[];
  separator?: string;
  arrayOps?: ArrayOp[];
  conditions?: ConditionClause[];
  params?: Record<string, unknown>;
}

export interface DeleteOptions {
  conditions?: ConditionClause[];
  params?: Record<string, unknown>;
}

export interface CloneOptions {
  force?: boolean;
  params?: Record<string, unknown>;
  reviveItems?: boolean;
  ignoreIndirection?: boolean;
}

export interface MoveOptions extends CloneOptions {}

export interface MassOptions {
  strategy?: 'native' | 'sequential';
  params?: Record<string, unknown>;
}

export interface ListOptions {
  offset?: number;
  limit?: number;
  descending?: boolean;
  consistent?: boolean;
  fields?: string | string[] | null;
  filter?: string;
  prefix?: string;
  caseSensitive?: boolean;
  needTotal?: boolean;
  reviveItems?: boolean;
  ignoreIndirection?: boolean;
}

export type BatchDescriptor =
  | {action: 'get'; adapter: Adapter<Record<string, unknown>>; params: GetCommandInput}
  | {action: 'check'; params: GetCommandInput}
  | {action: 'put'; params: PutCommandInput}
  | {action: 'patch'; params: UpdateCommandInput}
  | {action: 'delete'; params: DeleteCommandInput};

export class Adapter<TItem extends Record<string, unknown>, TKey = Partial<TItem>> {
  client: DynamoDBDocumentClient;
  table: string;
  keyFields: (keyof TItem & string)[];
  projectionFieldMap: Record<string, string>;
  searchable: Record<string, 1 | true>;
  searchablePrefix: string;
  indirectIndices: Record<string, 1 | true>;
  hooks: Required<AdapterHooks<TItem>>;

  constructor(options: AdapterOptions<TItem, TKey>);

  // Reads
  getByKey(key: TKey | Raw<TKey>, fields?: string | string[] | null, options?: GetOptions): Promise<TItem | undefined>;
  getByKeys(keys: (TKey | Raw<TKey>)[], fields?: string | string[] | null, options?: GetOptions): Promise<TItem[]>;
  getAll(options?: ListOptions, example?: Partial<TItem>, index?: string): Promise<PaginatedResult<TItem>>;
  getAllByParams(params: Record<string, unknown>, options?: ListOptions): Promise<PaginatedResult<TItem>>;

  // Writes — single
  post(item: TItem | Raw<TItem>): Promise<unknown>;
  put(item: TItem | Raw<TItem>, options?: PutOptions): Promise<unknown>;
  patch(key: TKey | Raw<TKey>, patch: Partial<TItem> | Raw<Partial<TItem>>, options?: PatchOptions): Promise<unknown>;
  delete(key: TKey | Raw<TKey>, options?: DeleteOptions): Promise<unknown>;
  clone(key: TKey | Raw<TKey>, mapFn?: (item: TItem) => TItem, options?: CloneOptions): Promise<TItem | undefined>;
  move(key: TKey | Raw<TKey>, mapFn?: (item: TItem) => TItem, options?: MoveOptions): Promise<TItem | undefined>;

  // Writes — mass
  putAll(items: (TItem | Raw<TItem>)[], options?: MassOptions): Promise<{processed: number}>;
  deleteByKeys(keys: (TKey | Raw<TKey>)[], options?: MassOptions): Promise<{processed: number}>;
  deleteAllByParams(params: Record<string, unknown>, options?: MassOptions): Promise<{processed: number}>;
  cloneByKeys(keys: (TKey | Raw<TKey>)[], mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  cloneAllByParams(params: Record<string, unknown>, mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  moveByKeys(keys: (TKey | Raw<TKey>)[], mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;
  moveAllByParams(params: Record<string, unknown>, mapFn?: (item: TItem) => TItem, options?: MassOptions): Promise<{processed: number}>;

  // Batch builders
  makeGet(key: TKey | Raw<TKey>, fields?: string | string[] | null, params?: Record<string, unknown>): Promise<BatchDescriptor & {action: 'get'}>;
  makeCheck(key: TKey | Raw<TKey>, params?: Record<string, unknown>): Promise<BatchDescriptor & {action: 'check'}>;
  makePost(item: TItem | Raw<TItem>): Promise<BatchDescriptor & {action: 'put'}>;
  makePut(item: TItem | Raw<TItem>, options?: PutOptions): Promise<BatchDescriptor & {action: 'put'}>;
  makePatch(key: TKey | Raw<TKey>, patch: Partial<TItem> | Raw<Partial<TItem>>, options?: PatchOptions): Promise<BatchDescriptor & {action: 'patch'}>;
  makeDelete(key: TKey | Raw<TKey>, options?: DeleteOptions): Promise<BatchDescriptor & {action: 'delete'}>;
}
