// Minimal stand-in for dynamodb-toolkit's Adapter — records every call for
// assertions and returns canned data. Tests focus on wire translation
// (Lambda event ↔ adapter methods), not on the Adapter's own DynamoDB behavior.

export const makeMockAdapter = (overrides = {}) => {
  const calls = [];
  const push = entry => {
    calls.push(entry);
    return entry;
  };

  const adapter = {
    keyFields: [{name: 'name', type: 'string'}],
    calls,
    async getList(opts, example, index) {
      push({fn: 'getList', opts, example, index});
      return {
        data: [{name: 'earth'}, {name: 'mars'}],
        offset: opts.offset,
        limit: opts.limit,
        total: 2
      };
    },
    async post(item) {
      push({fn: 'post', item});
    },
    async deleteListByParams(params) {
      push({fn: 'deleteListByParams', params});
      return {processed: 5};
    },
    async _buildListParams(opts, project, example, index) {
      push({fn: '_buildListParams', opts, project, example, index});
      return {IndexName: index, _built: true};
    },
    async getByKeys(keys, fields, opts) {
      push({fn: 'getByKeys', keys, fields, opts});
      return keys.map(k => ({...k, v: 1}));
    },
    async deleteByKeys(keys) {
      push({fn: 'deleteByKeys', keys});
      return {processed: keys.length};
    },
    async putItems(items) {
      push({fn: 'putItems', items});
      return {processed: items.length};
    },
    async cloneListByParams(params, mapFn) {
      push({fn: 'cloneListByParams', params, mapFn});
      return {processed: 3};
    },
    async moveListByParams(params, mapFn) {
      push({fn: 'moveListByParams', params, mapFn});
      return {processed: 3};
    },
    async cloneByKeys(keys, mapFn) {
      push({fn: 'cloneByKeys', keys, mapFn});
      return {processed: keys.length};
    },
    async moveByKeys(keys, mapFn) {
      push({fn: 'moveByKeys', keys, mapFn});
      return {processed: keys.length};
    },
    async getByKey(key, fields, opts) {
      push({fn: 'getByKey', key, fields, opts});
      return {...key, v: 1};
    },
    async put(item, opts) {
      push({fn: 'put', item, opts});
    },
    async patch(key, patchBody, opts) {
      push({fn: 'patch', key, patch: patchBody, opts});
    },
    async delete(key) {
      push({fn: 'delete', key});
    },
    async clone(key, mapFn, opts) {
      push({fn: 'clone', key, mapFn, opts});
      return {...key, v: 2};
    },
    async move(key, mapFn, opts) {
      push({fn: 'move', key, mapFn, opts});
      return {...key, v: 3};
    },
    ...overrides
  };

  return adapter;
};
