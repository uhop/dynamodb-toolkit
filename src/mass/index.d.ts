export {paginateList, type PaginateOptions, type PaginatedResult} from './paginate-list.js';
export {iterateList, iterateItems} from './iterate-list.js';
export {readOrderedListByKeys} from './read-ordered-list-by-keys.js';

import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

export function readList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  fn: (data: Record<string, unknown>) => Promise<void>
): Promise<Record<string, unknown> | null>;

export function readListGetItems(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>
): Promise<{nextParams: Record<string, unknown> | null; items: Record<string, unknown>[]}>;

export function readListByKeys<T = Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
  params?: Record<string, unknown>
): Promise<T[]>;

export function writeList(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
  mapFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

export function deleteList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  keyFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

export function deleteListByKeys(client: DynamoDBDocumentClient, tableName: string, keys: Record<string, unknown>[]): Promise<number>;

export function copyList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  mapFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

export function moveList(
  client: DynamoDBDocumentClient,
  params: Record<string, unknown>,
  mapFn?: (item: Record<string, unknown>) => Record<string, unknown>,
  keyFn?: (item: Record<string, unknown>) => Record<string, unknown>
): Promise<number>;

export function getTotal(client: DynamoDBDocumentClient, params: Record<string, unknown>): Promise<number>;
