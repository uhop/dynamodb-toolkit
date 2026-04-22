import type {RestPolicy} from '../policy.js';

export interface ListOptionsBase {
  offset: number;
  limit: number;
  consistent: boolean;
  needTotal?: boolean;
  fields?: string[];
  filter?: string;
}

/**
 * Build `ListOptions` for `adapter.getList` / `adapter._buildListParams` from
 * a string-only query map and a REST policy. Composes `parseFields`,
 * `parseFilter`, `parsePaging`, `parseFlag` under the policy's `defaultLimit`
 * / `maxLimit` / `maxOffset` / `needTotal` caps.
 *
 * @param query String-coerced query map (use `coerceStringQuery` first).
 * @param policy REST policy supplying pagination caps + `needTotal`.
 * @returns `ListOptions`-shaped object to pass to the Adapter.
 */
export function buildListOptions(query: Record<string, string>, policy: RestPolicy): ListOptionsBase;
