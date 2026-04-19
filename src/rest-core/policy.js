// Default REST policy: prefixes, envelope keys, status codes, paging defaults.
// Consumers override per-route or globally on the handler.

import {buildErrorBody} from './builders/build-error-body.js';

export const defaultPolicy = {
  metaPrefix: '_',
  dbPrefix: '-',
  methodPrefix: '-',
  envelope: {
    items: 'data',
    total: 'total',
    offset: 'offset',
    limit: 'limit',
    links: 'links'
  },
  statusCodes: {
    miss: 404,
    validation: 422,
    consistency: 409,
    throttle: 429,
    transient: 503,
    internal: 500
  },
  errorBody: buildErrorBody,
  needTotal: true,
  defaultLimit: 10,
  maxLimit: 100,
  maxOffset: 100_000
};

// Map an SDK error to a status code per policy. Falls back to internal (500).
export const mapErrorStatus = (err, statusCodes = defaultPolicy.statusCodes) => {
  const name = err?.name;
  switch (name) {
    case 'ConditionalCheckFailedException':
    case 'TransactionCanceledException':
    case 'TransactionConflictException':
      return statusCodes.consistency;
    case 'ValidationException':
    case 'ValidationError':
      return statusCodes.validation;
    case 'ProvisionedThroughputExceededException':
    case 'RequestLimitExceeded':
      return statusCodes.throttle;
    case 'ItemCollectionSizeLimitExceededException':
    case 'LimitExceededException':
      return statusCodes.throttle;
    case 'InternalServerError':
    case 'ServiceUnavailable':
      return statusCodes.transient;
    default:
      // Network / 5xx / unknown
      if (typeof err?.$metadata?.httpStatusCode === 'number' && err.$metadata.httpStatusCode >= 500) {
        return statusCodes.transient;
      }
      return statusCodes.internal;
  }
};

// Merge a partial policy override with the default.
export const mergePolicy = (overrides = {}) => ({
  ...defaultPolicy,
  ...overrides,
  envelope: {...defaultPolicy.envelope, ...(overrides.envelope || {})},
  statusCodes: {...defaultPolicy.statusCodes, ...(overrides.statusCodes || {})}
});
