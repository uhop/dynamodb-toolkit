// Build a KeyConditionExpression clause for DynamoDB's Query operation.
// Adapter-agnostic primitive — accepts a fully-prepared value string; the
// caller is responsible for joining keyFields values into the right shape.
// See adapter.buildKey() for the ergonomic surface that uses the Adapter's
// declared keyFields / structuralKey to build the prefix automatically.

// Input shape:
//   {
//     name: string,       // sort-key / structural-key field name
//     value: string,      // already-joined value (e.g. "TX|Dallas|" for children, "TX|Dallas" for exact)
//     kind: 'exact' | 'prefix',
//     pkName?: string,    // optional partition-key field name (adds `#pk = :pk` to the clause)
//     pkValue?: unknown
//   }
//
// Merges into `params` with counter-based placeholder names (`#kc<n>` /
// `:kcv<n>`), AND-combined with any existing KeyConditionExpression.

export const buildKeyCondition = (input, params = {}) => {
  const {name, value, kind, pkName, pkValue} = input;

  const names = params.ExpressionAttributeNames || {};
  const values = params.ExpressionAttributeValues || {};
  let nameCounter = Object.keys(names).length;
  let valueCounter = Object.keys(values).length;

  const allocName = fieldName => {
    const key = '#kc' + nameCounter++;
    names[key] = fieldName;
    return key;
  };
  const allocValue = v => {
    const key = ':kcv' + valueCounter++;
    values[key] = v;
    return key;
  };

  const clauses = [];

  if (pkName !== undefined && pkValue !== undefined) {
    clauses.push(allocName(pkName) + ' = ' + allocValue(pkValue));
  }

  const nameAlias = allocName(name);
  const valueAlias = allocValue(value);
  if (kind === 'prefix') {
    clauses.push('begins_with(' + nameAlias + ', ' + valueAlias + ')');
  } else {
    // Default: 'exact' — equality match on the sort/structural key.
    clauses.push(nameAlias + ' = ' + valueAlias);
  }

  const expr = clauses.join(' AND ');

  if (params.KeyConditionExpression) {
    params.KeyConditionExpression = '(' + params.KeyConditionExpression + ') AND (' + expr + ')';
  } else {
    params.KeyConditionExpression = expr;
  }

  if (Object.keys(names).length) params.ExpressionAttributeNames = names;
  if (Object.keys(values).length) params.ExpressionAttributeValues = values;
  return params;
};
