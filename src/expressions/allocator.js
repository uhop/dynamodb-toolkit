// @ts-self-types="./allocator.d.ts"
// Shared placeholder allocator for expression builders. Each builder mints
// `ExpressionAttributeNames` / `ExpressionAttributeValues` aliases through
// its own prefix pair, with counters seeded from the maps already on
// `params` — composing builders on the same `params` stays collision-free.

export const makeAllocator = (params, namePrefix, valuePrefix) => {
  const names = params.ExpressionAttributeNames || {};
  const values = params.ExpressionAttributeValues || {};
  let n = Object.keys(names).length;
  let v = Object.keys(values).length;
  return {
    names,
    values,
    name(fieldName) {
      const alias = namePrefix + n++;
      names[alias] = fieldName;
      return alias;
    },
    value(val) {
      const alias = valuePrefix + v++;
      values[alias] = val;
      return alias;
    },
    commit() {
      if (Object.keys(names).length) params.ExpressionAttributeNames = names;
      if (Object.keys(values).length) params.ExpressionAttributeValues = values;
      return params;
    }
  };
};
