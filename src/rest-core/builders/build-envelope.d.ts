import type {PaginatedResult} from '../../mass/paginate-list.js';

export interface EnvelopeKeys {
  items?: string;
  total?: string;
  offset?: string;
  limit?: string;
  links?: string;
}

export interface BuildEnvelopeOptions {
  keys?: EnvelopeKeys;
  links?: {prev: string | null; next: string | null};
}

export function buildEnvelope(result: PaginatedResult, options?: BuildEnvelopeOptions): Record<string, unknown>;
