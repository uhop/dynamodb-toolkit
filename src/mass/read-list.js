// Read a single page from a query or scan, call a callback, return next params or null.

import {cleanParams} from '../expressions/clean-params.js';
import {cloneParams} from '../expressions/clone-params.js';
import {sendQueryOrScan} from './send-query-or-scan.js';

export const readList = async (client, params, fn) => {
  params = cleanParams(cloneParams(params));
  const data = await sendQueryOrScan(client, params);
  await fn(data);
  if (data.LastEvaluatedKey) {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
    return params;
  }
  return null;
};

// Read a single page and return {nextParams, items}.
export const readListGetItems = async (client, params) => {
  params = cleanParams(cloneParams(params));
  const data = await sendQueryOrScan(client, params);
  if (data.LastEvaluatedKey) {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
  return {nextParams: data.LastEvaluatedKey ? params : null, items: data.Items || []};
};
