import type {EnvelopeKeys} from './builders/build-envelope.js';
import type {ErrorBody, BuildErrorBodyOptions} from './builders/build-error-body.js';

export interface RestStatusCodes {
  miss: number;
  validation: number;
  consistency: number;
  throttle: number;
  transient: number;
  internal: number;
}

export interface RestPolicy {
  metaPrefix: string;
  dbPrefix: string;
  methodPrefix: string;
  envelope: Required<EnvelopeKeys>;
  statusCodes: RestStatusCodes;
  errorBody: (err: unknown, options?: BuildErrorBodyOptions) => ErrorBody;
  needTotal: boolean;
  defaultLimit: number;
  maxLimit: number;
}

export const defaultPolicy: RestPolicy;

export function mapErrorStatus(err: unknown, statusCodes?: RestStatusCodes): number;

export function mergePolicy(overrides?: Partial<RestPolicy>): RestPolicy;
