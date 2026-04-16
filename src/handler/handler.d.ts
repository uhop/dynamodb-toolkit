import type {IncomingMessage, ServerResponse} from 'node:http';

import type {Adapter} from '../adapter/adapter.js';
import type {RestPolicy} from '../rest-core/policy.js';

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface HandlerOptions {
  policy?: Partial<RestPolicy>;
  sortableIndices?: Record<string, string>;
  keyFromPath?: (rawKey: string, adapter: Adapter<Record<string, unknown>>) => Record<string, unknown>;
  exampleFromContext?: (query: Record<string, string>, body: unknown) => Record<string, unknown>;
}

export function createHandler(adapter: Adapter<Record<string, unknown>>, options?: HandlerOptions): RequestHandler;
