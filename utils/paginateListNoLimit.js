'use strict';

const getTotal = require('./getTotal');
const cleanParams = require('./cleanParams');
const cloneParams = require('./cloneParams');

const paginateListNoLimit = async (client, params, options, needTotal = true, maxLimit = 100) => {
  options = options || {};
  let result = [],
    total = 0,
    offset = 0,
    limit = 10;
  if ('offset' in options && !isNaN(options.offset)) {
    offset = Math.floor(+options.offset);
  }
  if ('limit' in options && !isNaN(options.limit)) {
    limit = Math.min(maxLimit, Math.floor(+options.limit));
  }
  params = cloneParams(params);
  const action = params.KeyConditionExpression ? 'query' : 'scan';
  main: {
    if (offset < 0 || limit <= 0) {
      if (needTotal) {
        total = await getTotal(client, params);
      }
      break main;
    }
    // skip the offset
    let listingParams = cleanParams(cloneParams(params)),
      countingParams, skipped = 0;
    if (offset > 0) {
      countingParams = cloneParams(params);
      countingParams.Select = 'COUNT';
      delete countingParams.ProjectionExpression;
      cleanParams(countingParams);
      while (skipped < offset) {
        const data = await client[action](countingParams).promise();
        if (skipped + data.Count > offset) break;
        total += data.Count;
        skipped += data.Count;
        if (!data.LastEvaluatedKey) break main;
        countingParams.ExclusiveStartKey = data.LastEvaluatedKey;
      }
      const lastKey = countingParams.ExclusiveStartKey;
      lastKey && (listingParams.ExclusiveStartKey = lastKey);
    }
    // collect items
    while (result.length < limit) {
      const data = await client[action](listingParams).promise();
      if (data.Count) {
        total += data.Count;
        if (skipped < offset) {
          result = result.concat(data.Items.slice(offset - skipped, limit - result.length));
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
      if (!data.LastEvaluatedKey) break main;
    }
    // count the rest if requested
    if (needTotal) {
      const lastKey = listingParams.ExclusiveStartKey;
      if (!countingParams) {
        countingParams = cloneParams(params);
        countingParams.Select = 'COUNT';
        delete countingParams.ProjectionExpression;
        cleanParams(countingParams);
      }
      lastKey && (countingParams.ExclusiveStartKey = lastKey);
      for (;;) {
        const data = await client[action](countingParams).promise();
        total += data.Count;
        countingParams.ExclusiveStartKey = data.LastEvaluatedKey;
        if (!data.LastEvaluatedKey) break main;
      }
    }
  }
  // return the result
  const output = {data: result, offset, limit};
  needTotal && (output.total = total);
  return output;
};

module.exports = paginateListNoLimit;
