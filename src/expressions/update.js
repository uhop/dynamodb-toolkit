// Build an UpdateExpression for DynamoDB from a patch object and options.

const isInteger = /^\d+$/;

const aliasPath = (path, separator, uniqueNames, names, keyCounter) => {
  return path.split(separator).map(part => {
    if (isInteger.test(part)) return part;
    let alias = uniqueNames['#' + part];
    if (!alias) {
      alias = uniqueNames['#' + part] = '#upk' + keyCounter.n++;
      names[alias] = part;
    }
    return alias;
  });
};

const joinPath = parts => parts.reduce((acc, part) => acc + (acc ? (isInteger.test(part) ? '[' + part + ']' : '.' + part) : part), '');

export const buildUpdate = (patch, options, params = {}) => {
  const separator = options?.separator || '.';
  const deleteProps = options?.delete;
  const arrayOps = options?.arrayOps;

  const names = params.ExpressionAttributeNames || {},
    values = params.ExpressionAttributeValues || {},
    uniqueNames = {};
  const keyCounter = {n: Object.keys(names).length};
  let valueCounter = Object.keys(values).length;

  const setActions = [];
  const removeActions = [];
  const addActions = [];

  // Regular field SET actions
  for (const key of Object.keys(patch)) {
    const parts = aliasPath(key, separator, uniqueNames, names, keyCounter);
    const valueAlias = ':upv' + valueCounter++;
    values[valueAlias] = patch[key];
    setActions.push(joinPath(parts) + ' = ' + valueAlias);
  }

  // REMOVE actions from options.delete
  if (Array.isArray(deleteProps)) {
    for (const key of deleteProps) {
      const parts = aliasPath(key, separator, uniqueNames, names, keyCounter);
      removeActions.push(joinPath(parts));
    }
  }

  // Array operations
  if (Array.isArray(arrayOps)) {
    for (const op of arrayOps) {
      const parts = aliasPath(op.path, separator, uniqueNames, names, keyCounter);
      const pathExpr = joinPath(parts);

      switch (op.op) {
        case 'append': {
          const emptyAlias = ':upv' + valueCounter++;
          values[emptyAlias] = [];
          const valAlias = ':upv' + valueCounter++;
          values[valAlias] = op.values;
          setActions.push(pathExpr + ' = list_append(if_not_exists(' + pathExpr + ', ' + emptyAlias + '), ' + valAlias + ')');
          break;
        }
        case 'prepend': {
          const emptyAlias = ':upv' + valueCounter++;
          values[emptyAlias] = [];
          const valAlias = ':upv' + valueCounter++;
          values[valAlias] = op.values;
          setActions.push(pathExpr + ' = list_append(' + valAlias + ', if_not_exists(' + pathExpr + ', ' + emptyAlias + '))');
          break;
        }
        case 'setAtIndex': {
          const valAlias = ':upv' + valueCounter++;
          values[valAlias] = op.value;
          setActions.push(pathExpr + '[' + op.index + '] = ' + valAlias);
          break;
        }
        case 'removeAtIndex': {
          removeActions.push(pathExpr + '[' + op.index + ']');
          break;
        }
        case 'add': {
          const valAlias = ':upv' + valueCounter++;
          values[valAlias] = op.value;
          addActions.push(pathExpr + ' ' + valAlias);
          break;
        }
        default:
          throw new Error(`buildUpdate: unknown arrayOp "${op.op}" (expected append | prepend | setAtIndex | removeAtIndex | add)`);
      }
    }
  }

  if (Object.keys(names).length) params.ExpressionAttributeNames = names;

  const parts = [];
  if (setActions.length) parts.push('SET ' + setActions.join(', '));
  if (removeActions.length) parts.push('REMOVE ' + removeActions.join(', '));
  if (addActions.length) parts.push('ADD ' + addActions.join(', '));
  params.UpdateExpression = parts.join(' ');

  if (setActions.length || addActions.length) params.ExpressionAttributeValues = values;

  return params;
};
