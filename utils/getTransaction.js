'use strict';

const doBatch = async (client, batch) => client.transactGetItems({TransactItems: batch}).promise();

const getTransaction = async (client, ...requests) => {
  let batch = [], adapters = [];

  for (const request of requests) {
    if (!request) continue;
    const params = request.params,
      base = {};
    if (params) {
      params.ProjectionExpression && (base.ProjectionExpression = params.ProjectionExpression);
      params.ExpressionAttributeNames && (base.ExpressionAttributeNames = params.ExpressionAttributeNames);
    }
    switch (request.action) {
      case 'get':
        for (const key of request.keys) {
          batch.push({Get: {TableName: request.table, Key: key, ...base}});
          adapters.push(request.adapter);
        }
        break;
    }
  }
  if (!batch.length) return [];
  const result = await doBatch(client, batch);
  return result.responses.map((item, index) => ({table: batch[index].TableName, item: item && item.Item, adapter: adapters[index]}));
};

module.exports = getTransaction;
