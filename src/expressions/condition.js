// @ts-self-types="./condition.d.ts"
// Build a ConditionExpression for DynamoDB from a declarative clause tree.

import {makeAllocator} from './allocator.js';

const isInteger = /^\d+$/;

const aliasPath = (path, alloc, separator = '.') => path.split(separator).map(part => (isInteger.test(part) ? part : alloc.name(part)));

const joinPath = parts => parts.reduce((acc, part) => acc + (acc ? (isInteger.test(part) ? '[' + part + ']' : '.' + part) : part), '');

const buildClause = (clause, alloc) => {
  if (clause.op === 'and' || clause.op === 'or') {
    const sub = clause.clauses.map(c => buildClause(c, alloc));
    return '(' + sub.join(clause.op === 'and' ? ' AND ' : ' OR ') + ')';
  }

  if (clause.op === 'not') {
    return 'NOT (' + buildClause(clause.clause, alloc) + ')';
  }

  const path = joinPath(aliasPath(clause.path, alloc));

  switch (clause.op) {
    case 'exists':
      return 'attribute_exists(' + path + ')';
    case 'notExists':
      return 'attribute_not_exists(' + path + ')';
    case 'beginsWith':
      return 'begins_with(' + path + ', ' + alloc.value(clause.value) + ')';
    case 'contains':
      return 'contains(' + path + ', ' + alloc.value(clause.value) + ')';
    case 'in': {
      // values: legacy alias (pre-3.8) — `value` is the polymorphic knob
      const aliases = (clause.value ?? clause.values).map(val => alloc.value(val));
      return path + ' IN (' + aliases.join(', ') + ')';
    }
    default:
      // comparison operators: =, <>, <, <=, >, >=
      return path + ' ' + clause.op + ' ' + alloc.value(clause.value);
  }
};

export const buildCondition = (clauses, params = {}) => {
  if (!clauses || !clauses.length) return params;

  const alloc = makeAllocator(params, '#cd', ':cdv');
  const expr = clauses.map(c => buildClause(c, alloc)).join(' AND ');

  if (params.ConditionExpression) {
    params.ConditionExpression = '(' + params.ConditionExpression + ') AND (' + expr + ')';
  } else {
    params.ConditionExpression = expr;
  }

  alloc.commit();
  return params;
};
