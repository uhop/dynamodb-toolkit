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
export {coerceStringQuery} from './parsers/coerce-string-query.js';

export {buildEnvelope, type EnvelopeKeys, type BuildEnvelopeOptions} from './builders/build-envelope.js';
export {buildErrorBody, type ErrorBody, type BuildErrorBodyOptions} from './builders/build-error-body.js';
export {paginationLinks, type PaginationLinks, type UrlBuilder} from './builders/pagination-links.js';
export {buildListOptions, type ListOptionsBase} from './builders/build-list-options.js';
export {resolveSort, type ResolvedSort} from './builders/resolve-sort.js';
export {stripMount} from './builders/strip-mount.js';
export {validateWriteBody, type ValidateWriteBodyOptions} from './builders/validate-write-body.js';

export {defaultPolicy, mapErrorStatus, mergePolicy, type RestPolicy, type RestStatusCodes} from './policy.js';
