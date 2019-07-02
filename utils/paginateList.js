'use strict';

const getTotal = require('./getTotal');
const cleanParams = require('./cleanParams');

const paginateList = async (client, action, params, options, needTotal = true, minLimit = 10, maxLimit = 100) => {
  options = options || {};
  let result = [],
    total = 0,
    offset = 0,
    limit = 10;
  params = Object.assign({}, params);
  if ('offset' in options && !isNaN(options.offset)) {
    offset = Math.floor(+options.offset);
  }
  if ('limit' in options && !isNaN(options.limit)) {
    limit = Math.min(maxLimit, Math.floor(+options.limit));
  }
  main: {
    if (offset < 0 || limit <= 0) {
      if (needTotal) {
        total = await getTotal(client, action, params);
      }
      break main;
    }
    // skip the offset
    let p = Object.assign({}, params),
      countingParams;
    if (offset > 0) {
      let skipped = 0;
      if (offset > minLimit) {
        countingParams = Object.assign({}, params);
        countingParams.ExpressionAttributeNames && (countingParams.ExpressionAttributeNames = Object.assign({}, countingParams.ExpressionAttributeNames));
        countingParams.Select = 'COUNT';
        delete countingParams.ProjectionExpression;
        cleanParams(countingParams);
        while (offset - skipped > minLimit) {
          countingParams.Limit = offset - skipped;
          const data = await client[action](countingParams).promise();
          total += data.Count;
          skipped += data.Count;
          if (!data.LastEvaluatedKey) break main;
          countingParams.ExclusiveStartKey = data.LastEvaluatedKey;
        }
        delete countingParams.Limit;
        const lastKey = countingParams.ExclusiveStartKey;
        lastKey && (p.ExclusiveStartKey = lastKey);
      }
      while (skipped < offset) {
        p.Limit = minLimit;
        const data = await client[action](p).promise();
        total += data.Count;
        if (offset - skipped < data.Count) {
          result = result.concat(data.Items.slice(offset - skipped, offset - skipped + limit));
          skipped = offset;
        } else {
          skipped += data.Count;
        }
        p.ExclusiveStartKey = data.LastEvaluatedKey;
        if (!data.LastEvaluatedKey) break main;
      }
    }
    // get up to the limit
    while (result.length < limit) {
      p.Limit = Math.max(minLimit, limit - result.length);
      const data = await client[action](p).promise();
      total += data.Count;
      if (data.Count > 0) {
        if (result.length + data.Count <= limit) {
          result = result.concat(data.Items);
        } else {
          result = result.concat(data.Items.slice(0, limit - result.length));
        }
      }
      p.ExclusiveStartKey = data.LastEvaluatedKey;
      if (!data.LastEvaluatedKey) {
        break main;
      }
    }
    // count the rest if requested
    if (needTotal) {
      const lastKey = p.ExclusiveStartKey;
      if (!countingParams) {
        countingParams = Object.assign({}, params);
        countingParams.ExpressionAttributeNames && (countingParams.ExpressionAttributeNames = Object.assign({}, countingParams.ExpressionAttributeNames));
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

module.exports = paginateList;
