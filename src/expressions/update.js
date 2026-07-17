// @ts-self-types="./update.d.ts"
// Build an UpdateExpression for DynamoDB from a patch object and options.

import {makeAllocator} from './allocator.js';

const isInteger = /^\d+$/;

// `uniqueNames` memo: the same path segment reused across the patch gets one alias.
const aliasPath = (path, separator, uniqueNames, alloc) => {
  return path.split(separator).map(part => {
    if (isInteger.test(part)) return part;
    let alias = uniqueNames['#' + part];
    if (!alias) alias = uniqueNames['#' + part] = alloc.name(part);
    return alias;
  });
};

const joinPath = parts => parts.reduce((acc, part) => acc + (acc ? (isInteger.test(part) ? '[' + part + ']' : '.' + part) : part), '');

export const buildUpdate = (patch, options, params = {}) => {
  const separator = options?.separator || '.';
  const deleteProps = options?.delete;
  const arrayOps = options?.arrayOps;

  const alloc = makeAllocator(params, '#upk', ':upv');
  const uniqueNames = {};

  const setActions = [];
  const removeActions = [];
  const addActions = [];

  // Regular field SET actions
  for (const key of Object.keys(patch)) {
    const parts = aliasPath(key, separator, uniqueNames, alloc);
    setActions.push(joinPath(parts) + ' = ' + alloc.value(patch[key]));
  }

  // REMOVE actions from options.delete
  if (Array.isArray(deleteProps)) {
    for (const key of deleteProps) {
      const parts = aliasPath(key, separator, uniqueNames, alloc);
      removeActions.push(joinPath(parts));
    }
  }

  // Array operations
  if (Array.isArray(arrayOps)) {
    for (const op of arrayOps) {
      const parts = aliasPath(op.path, separator, uniqueNames, alloc);
      const pathExpr = joinPath(parts);

      switch (op.op) {
        case 'append': {
          const emptyAlias = alloc.value([]);
          const valAlias = alloc.value(op.values);
          setActions.push(pathExpr + ' = list_append(if_not_exists(' + pathExpr + ', ' + emptyAlias + '), ' + valAlias + ')');
          break;
        }
        case 'prepend': {
          const emptyAlias = alloc.value([]);
          const valAlias = alloc.value(op.values);
          setActions.push(pathExpr + ' = list_append(' + valAlias + ', if_not_exists(' + pathExpr + ', ' + emptyAlias + '))');
          break;
        }
        case 'setAtIndex': {
          setActions.push(pathExpr + '[' + op.index + '] = ' + alloc.value(op.value));
          break;
        }
        case 'removeAtIndex': {
          removeActions.push(pathExpr + '[' + op.index + ']');
          break;
        }
        case 'add': {
          addActions.push(pathExpr + ' ' + alloc.value(op.value));
          break;
        }
        default:
          throw new Error(`buildUpdate: unknown arrayOp "${op.op}" (expected append | prepend | setAtIndex | removeAtIndex | add)`);
      }
    }
  }

  if (Object.keys(alloc.names).length) params.ExpressionAttributeNames = alloc.names;

  const parts = [];
  if (setActions.length) parts.push('SET ' + setActions.join(', '));
  if (removeActions.length) parts.push('REMOVE ' + removeActions.join(', '));
  if (addActions.length) parts.push('ADD ' + addActions.join(', '));
  params.UpdateExpression = parts.join(' ');

  // values attach only when a value-carrying action exists — REMOVE-only
  // updates must not ship an empty (or stale) values map.
  if (setActions.length || addActions.length) params.ExpressionAttributeValues = alloc.values;

  return params;
};
