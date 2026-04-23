import type {RestPolicy} from '../policy.js';
import type {FilterClause} from '../parsers/parse-filter.js';

export interface ListOptionsBase {
  offset: number;
  limit: number;
  consistent: boolean;
  needTotal?: boolean;
  fields?: string[];
  /** Structured filter clauses from `?<op>-<field>=<value>` URL params. */
  filter?: FilterClause[];
  /** Free-form search string from `?search=` URL param; matched against `searchable` mirror columns. */
  search?: string;
}

/**
 * Build `ListOptions` for `adapter.getList` / `adapter._buildListParams` from
 * a string-only query map and a REST policy. Composes `parseFields`,
 * `parseFilter`, `parseSearch`, `parsePaging`, `parseFlag` under the policy's
 * `defaultLimit` / `maxLimit` / `maxOffset` / `needTotal` caps.
 *
 * @param query String-coerced query map (use `coerceStringQuery` first).
 * @param policy REST policy supplying pagination caps + `needTotal`.
 * @returns `ListOptions`-shaped object to pass to the Adapter.
 */
export function buildListOptions(query: Record<string, string>, policy: RestPolicy): ListOptionsBase;
