// Count total items matching params via Select: COUNT pagination.

import {sendQueryOrScan} from './send-query-or-scan.js';

export const getTotal = async (client, params) => {
  let counter = 0;
  const p = {...params, Select: 'COUNT'};
  delete p.ProjectionExpression;
  for (;;) {
    const data = await sendQueryOrScan(client, p);
    counter += data.Count;
    if (!data.LastEvaluatedKey) break;
    p.ExclusiveStartKey = data.LastEvaluatedKey;
  }
  return counter;
};
