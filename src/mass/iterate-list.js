// Async generator that yields raw DynamoDB response pages.

import {cleanParams} from '../expressions/clean-params.js';
import {cloneParams} from '../expressions/clone-params.js';
import {sendQueryOrScan} from './send-query-or-scan.js';

export async function* iterateList(client, params) {
  params = cleanParams(cloneParams(params));
  for (;;) {
    const data = await sendQueryOrScan(client, params);
    yield data;
    if (!data.LastEvaluatedKey) break;
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  }
}

// Convenience: yields individual items instead of pages.
export async function* iterateItems(client, params) {
  for await (const data of iterateList(client, params)) {
    if (data.Items?.length) yield* data.Items;
  }
}
