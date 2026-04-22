// Build a KeyConditionExpression clause for DynamoDB's Query operation.
// Adapter-agnostic primitive — accepts a fully-prepared value string; the
// caller is responsible for joining keyFields values into the right shape.
// See adapter.buildKey() for the ergonomic surface that uses the Adapter's
// declared keyFields / structuralKey to build the prefix automatically.

// Input shape:
//   {
//     field: string,       // sort-key field name (or structural-key field name)
//     value: string,       // already-joined value (e.g. "TX|Dallas|" for children, "TX|Dallas" for exact)
//     kind: 'exact' | 'prefix',
//     pkField?: string,    // optional partition-key field (adds `#pk = :pk` to the clause)
//     pkValue?: unknown
//   }
//
// Merges into `params` with counter-based placeholder names (`#kc<n>` /
// `:kcv<n>`), AND-combined with any existing KeyConditionExpression.

export const buildKeyCondition = (input, params = {}) => {
  const {field, value, kind, pkField, pkValue} = input;

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

  if (pkField !== undefined && pkValue !== undefined) {
    clauses.push(allocName(pkField) + ' = ' + allocValue(pkValue));
  }

  const fieldAlias = allocName(field);
  const valueAlias = allocValue(value);
  if (kind === 'prefix') {
    clauses.push('begins_with(' + fieldAlias + ', ' + valueAlias + ')');
  } else {
    // Default: 'exact' — equality match on the sort/structural key.
    clauses.push(fieldAlias + ' = ' + valueAlias);
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
