'use strict';

const getTotal = async (client, params) => {
  const action = params.KeyConditionExpression ? 'query' : 'scan';
  let counter = 0;
  const p = Object.assign({}, params);
  delete p.ProjectionExpression;
  p.Select = 'COUNT';
  for (;;) {
    const data = await client[action](p).promise();
    counter += data.Count;
    if (!data.LastEvaluatedKey) {
      break;
    }
    p.ExclusiveStartKey = data.LastEvaluatedKey;
  }
  return counter;
};

module.exports = getTotal;
