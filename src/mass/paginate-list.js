// Offset/limit pagination with filter accumulation.
// When FilterExpression is present, DynamoDB's Limit is pre-filter — we must accumulate matches.

import {cleanParams} from '../expressions/clean-params.js';
import {cloneParams} from '../expressions/clone-params.js';
import {sendQueryOrScan} from './send-query-or-scan.js';
import {getTotal} from './get-total.js';

export const paginateList = async (client, params, options, needTotal = true, minLimit = 10, maxLimit = 100) => {
  if (params.FilterExpression) return paginateListFiltered(client, params, options, needTotal, maxLimit);

  options = options || {};
  let result = [],
    total = 0,
    offset = 0,
    limit = minLimit;
  if ('offset' in options && !isNaN(options.offset)) offset = Math.floor(+options.offset);
  if ('limit' in options && !isNaN(options.limit)) limit = Math.min(maxLimit, Math.floor(+options.limit));

  params = cloneParams(params);

  done: {
    if (offset < 0 || limit <= 0) {
      if (needTotal) total = await getTotal(client, params);
      break done;
    }

    let listingParams = cleanParams(cloneParams(params)),
      countingParams;

    // Skip offset
    if (offset > 0) {
      let skipped = 0;
      if (offset > minLimit) {
        countingParams = cloneParams(params);
        countingParams.Select = 'COUNT';
        delete countingParams.ProjectionExpression;
        cleanParams(countingParams);
        while (offset - skipped > minLimit) {
          countingParams.Limit = offset - skipped;
          const data = await sendQueryOrScan(client, countingParams);
          total += data.Count;
          skipped += data.Count;
          if (!data.LastEvaluatedKey) break done;
          countingParams.ExclusiveStartKey = data.LastEvaluatedKey;
        }
        delete countingParams.Limit;
        const lastKey = countingParams.ExclusiveStartKey;
        if (lastKey) listingParams.ExclusiveStartKey = lastKey;
      }
      while (skipped < offset) {
        listingParams.Limit = minLimit;
        const data = await sendQueryOrScan(client, listingParams);
        total += data.Count;
        if (offset - skipped < data.Count) {
          result = result.concat(data.Items.slice(offset - skipped, offset - skipped + limit));
          skipped = offset;
        } else {
          skipped += data.Count;
        }
        listingParams.ExclusiveStartKey = data.LastEvaluatedKey;
        if (!data.LastEvaluatedKey) break done;
      }
    }

    // Collect up to limit
    while (result.length < limit) {
      listingParams.Limit = Math.max(minLimit, limit - result.length);
      const data = await sendQueryOrScan(client, listingParams);
      total += data.Count;
      if (data.Count > 0) {
        if (result.length + data.Count <= limit) {
          result = result.concat(data.Items);
        } else {
          result = result.concat(data.Items.slice(0, limit - result.length));
        }
      }
      listingParams.ExclusiveStartKey = data.LastEvaluatedKey;
      if (!data.LastEvaluatedKey) break done;
    }

    // Count the rest
    if (needTotal) {
      const lastKey = listingParams.ExclusiveStartKey;
      if (!countingParams) {
        countingParams = cloneParams(params);
        countingParams.Select = 'COUNT';
        delete countingParams.ProjectionExpression;
        cleanParams(countingParams);
      }
      if (lastKey) countingParams.ExclusiveStartKey = lastKey;
      for (;;) {
        const data = await sendQueryOrScan(client, countingParams);
        total += data.Count;
        countingParams.ExclusiveStartKey = data.LastEvaluatedKey;
        if (!data.LastEvaluatedKey) break done;
      }
    }
  }

  const output = {data: result, offset, limit};
  if (needTotal) output.total = total;
  return output;
};

// Filtered variant: DynamoDB's Limit is pre-filter, so we must scan all and accumulate matching items.
const paginateListFiltered = async (client, params, options, needTotal, maxLimit) => {
  options = options || {};
  let result = [],
    total = 0,
    offset = 0,
    limit = 10;
  if ('offset' in options && !isNaN(options.offset)) offset = Math.floor(+options.offset);
  if ('limit' in options && !isNaN(options.limit)) limit = Math.min(maxLimit, Math.floor(+options.limit));

  params = cloneParams(params);

  done: {
    if (offset < 0 || limit <= 0) {
      if (needTotal) total = await getTotal(client, params);
      break done;
    }

    let listingParams = cleanParams(cloneParams(params)),
      countingParams,
      skipped = 0;

    // Skip offset using COUNT
    if (offset > 0) {
      countingParams = cloneParams(params);
      countingParams.Select = 'COUNT';
      delete countingParams.ProjectionExpression;
      cleanParams(countingParams);
      while (skipped < offset) {
        const data = await sendQueryOrScan(client, countingParams);
        if (skipped + data.Count > offset) break;
        total += data.Count;
        skipped += data.Count;
        if (!data.LastEvaluatedKey) break done;
        countingParams.ExclusiveStartKey = data.LastEvaluatedKey;
      }
      const lastKey = countingParams.ExclusiveStartKey;
      if (lastKey) listingParams.ExclusiveStartKey = lastKey;
    }

    // Collect items
    while (result.length < limit) {
      const data = await sendQueryOrScan(client, listingParams);
      if (data.Count) {
        total += data.Count;
        if (skipped < offset) {
          result = data.Items.slice(offset - skipped, limit + offset - skipped);
          skipped = offset;
        } else {
          if (result.length + data.Count <= limit) {
            result = result.concat(data.Items);
          } else {
            result = result.concat(data.Items.slice(0, limit - result.length));
          }
        }
      }
      listingParams.ExclusiveStartKey = data.LastEvaluatedKey;
      if (!data.LastEvaluatedKey) break done;
    }

    // Count the rest
    if (needTotal) {
      const lastKey = listingParams.ExclusiveStartKey;
      if (!countingParams) {
        countingParams = cloneParams(params);
        countingParams.Select = 'COUNT';
        delete countingParams.ProjectionExpression;
        cleanParams(countingParams);
      }
      if (lastKey) countingParams.ExclusiveStartKey = lastKey;
      for (;;) {
        const data = await sendQueryOrScan(client, countingParams);
        total += data.Count;
        countingParams.ExclusiveStartKey = data.LastEvaluatedKey;
        if (!data.LastEvaluatedKey) break done;
      }
    }
  }

  const output = {data: result, offset, limit};
  if (needTotal) output.total = total;
  return output;
};
