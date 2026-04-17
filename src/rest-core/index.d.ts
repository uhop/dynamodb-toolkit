/**
 * REST core — framework-agnostic parsers, builders, and policy. Every symbol
 * carries JSDoc at its defining module; IDE hover follows the re-export chain.
 */

export {parseFields} from './parsers/parse-fields.js';
export {parseSort, type ParsedSort, type SortClause} from './parsers/parse-sort.js';
export {parseFilter, type ParsedFilter, type ParseFilterOptions} from './parsers/parse-filter.js';
export {parsePatch, type ParsedPatch, type ParsePatchOptions} from './parsers/parse-patch.js';
export {parseNames} from './parsers/parse-names.js';
export {parsePaging, type ParsedPaging, type ParsePagingOptions} from './parsers/parse-paging.js';
export {parseFlag} from './parsers/parse-flag.js';

export {buildEnvelope, type EnvelopeKeys, type BuildEnvelopeOptions} from './builders/build-envelope.js';
export {buildErrorBody, type ErrorBody, type BuildErrorBodyOptions} from './builders/build-error-body.js';
export {paginationLinks, type PaginationLinks, type UrlBuilder} from './builders/pagination-links.js';

export {defaultPolicy, mapErrorStatus, mergePolicy, type RestPolicy, type RestStatusCodes} from './policy.js';
