// Execute a TransactGetItems request.

import {TransactGetCommand} from '@aws-sdk/lib-dynamodb';

const flatten = requests => {
  const items = [];
  const adapters = [];
  for (const r of requests) {
    if (!r) continue;
    if (Array.isArray(r)) {
      for (const item of r) {
        if (item && item.action === 'get') {
          items.push({Get: item.params});
          adapters.push(item.adapter);
        }
      }
    } else if (r.action === 'get') {
      items.push({Get: r.params});
      adapters.push(r.adapter);
    }
  }
  return {items, adapters};
};

export const getTransaction = async (client, ...requests) => {
  const {items, adapters} = flatten(requests);
  if (!items.length) return [];
  const data = await client.send(new TransactGetCommand({TransactItems: items}));
  return (data.Responses || []).map((response, index) => ({
    table: items[index]?.Get?.TableName,
    item: response?.Item ?? null,
    adapter: adapters[index]
  }));
};
