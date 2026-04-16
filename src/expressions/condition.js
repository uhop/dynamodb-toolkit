// Build a ConditionExpression for DynamoDB from a declarative clause tree.

const isInteger = /^\d+$/;

const aliasPath = (path, names, counter, separator = '.') =>
  path.split(separator).map(part => {
    if (isInteger.test(part)) return part;
    const key = '#cd' + counter.n++;
    names[key] = part;
    return key;
  });

const joinPath = parts => parts.reduce((acc, part) => acc + (acc ? (isInteger.test(part) ? '[' + part + ']' : '.' + part) : part), '');

const buildClause = (clause, names, values, counter, vCounter) => {
  if (clause.op === 'and' || clause.op === 'or') {
    const sub = clause.clauses.map(c => buildClause(c, names, values, counter, vCounter));
    return '(' + sub.join(clause.op === 'and' ? ' AND ' : ' OR ') + ')';
  }

  if (clause.op === 'not') {
    return 'NOT (' + buildClause(clause.clause, names, values, counter, vCounter) + ')';
  }

  const path = joinPath(aliasPath(clause.path, names, counter));

  switch (clause.op) {
    case 'exists':
      return 'attribute_exists(' + path + ')';
    case 'notExists':
      return 'attribute_not_exists(' + path + ')';
    case 'beginsWith': {
      const v = ':cdv' + vCounter.n++;
      values[v] = clause.value;
      return 'begins_with(' + path + ', ' + v + ')';
    }
    case 'contains': {
      const v = ':cdv' + vCounter.n++;
      values[v] = clause.value;
      return 'contains(' + path + ', ' + v + ')';
    }
    case 'in': {
      const aliases = clause.values.map(val => {
        const v = ':cdv' + vCounter.n++;
        values[v] = val;
        return v;
      });
      return path + ' IN (' + aliases.join(', ') + ')';
    }
    default: {
      // comparison operators: =, <>, <, <=, >, >=
      const v = ':cdv' + vCounter.n++;
      values[v] = clause.value;
      return path + ' ' + clause.op + ' ' + v;
    }
  }
};

export const buildCondition = (clauses, params = {}) => {
  if (!clauses || !clauses.length) return params;

  const names = params.ExpressionAttributeNames || {};
  const values = params.ExpressionAttributeValues || {};
  const counter = {n: Object.keys(names).length};
  const vCounter = {n: Object.keys(values).length};

  const expr = clauses.map(c => buildClause(c, names, values, counter, vCounter)).join(' AND ');

  if (params.ConditionExpression) {
    params.ConditionExpression = '(' + params.ConditionExpression + ') AND (' + expr + ')';
  } else {
    params.ConditionExpression = expr;
  }

  if (Object.keys(names).length) params.ExpressionAttributeNames = names;
  if (Object.keys(values).length) params.ExpressionAttributeValues = values;
  return params;
};
