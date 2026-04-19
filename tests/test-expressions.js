import test from 'tape-six';
import {buildUpdate, addProjection, buildFilter, buildFilterByExample, buildCondition, cleanParams, cloneParams} from 'dynamodb-toolkit/expressions';

// buildUpdate — basic SET

test('buildUpdate: single field SET', t => {
  const result = buildUpdate({name: 'Bespin'});
  t.equal(result.UpdateExpression, 'SET #upk0 = :upv0');
  t.equal(result.ExpressionAttributeNames['#upk0'], 'name');
  t.equal(result.ExpressionAttributeValues[':upv0'], 'Bespin');
});

test('buildUpdate: multiple fields', t => {
  const result = buildUpdate({name: 'Bespin', climate: 'temperate'});
  t.matchString(result.UpdateExpression, /^SET /);
  t.matchString(result.UpdateExpression, /#upk0 = :upv0/);
  t.matchString(result.UpdateExpression, /#upk1 = :upv1/);
});

test('buildUpdate: nested dotted path', t => {
  const result = buildUpdate({'config.timeout': 30});
  t.matchString(result.UpdateExpression, /#upk0\.#upk1 = :upv0/);
  t.equal(result.ExpressionAttributeNames['#upk0'], 'config');
  t.equal(result.ExpressionAttributeNames['#upk1'], 'timeout');
});

test('buildUpdate: array index in path', t => {
  const result = buildUpdate({'items.2.qty': 5});
  t.matchString(result.UpdateExpression, /#upk0\[2\]\.#upk1 = :upv0/);
});

// buildUpdate — REMOVE

test('buildUpdate: delete paths via options', t => {
  const result = buildUpdate({}, {delete: ['old', 'obsolete']});
  t.matchString(result.UpdateExpression, /REMOVE #upk0, #upk1/);
  t.equal(result.ExpressionAttributeNames['#upk0'], 'old');
});

test('buildUpdate: SET + REMOVE combined', t => {
  const result = buildUpdate({name: 'Bespin'}, {delete: ['old']});
  t.matchString(result.UpdateExpression, /SET /);
  t.matchString(result.UpdateExpression, /REMOVE /);
});

test('buildUpdate: non-array options.delete is ignored', t => {
  const result = buildUpdate({x: 1}, {delete: 'old'});
  t.doesNotMatchString(result.UpdateExpression, /REMOVE/, 'string delete does not iterate chars');
  t.matchString(result.UpdateExpression, /SET /);
});

test('buildUpdate: non-array options.arrayOps is ignored', t => {
  const result = buildUpdate({x: 1}, {arrayOps: 'nope'});
  t.matchString(result.UpdateExpression, /SET #upk0 = :upv0/);
});

test('buildUpdate: unknown arrayOp.op throws', t => {
  t.throws(() => buildUpdate({}, {arrayOps: [{op: 'increment', path: 'n', value: 1}]}), 'unknown op rejected');
});

// buildUpdate — custom separator

test('buildUpdate: custom separator', t => {
  const result = buildUpdate({'a/b': 1}, {separator: '/'});
  t.matchString(result.UpdateExpression, /#upk0\.#upk1 = :upv0/);
});

// buildUpdate — array ops

test('buildUpdate: append', t => {
  const result = buildUpdate({}, {arrayOps: [{op: 'append', path: 'tags', values: ['new']}]});
  t.matchString(result.UpdateExpression, /list_append\(if_not_exists\(#upk0, :upv0\), :upv1\)/);
  t.deepEqual(result.ExpressionAttributeValues[':upv0'], []);
  t.deepEqual(result.ExpressionAttributeValues[':upv1'], ['new']);
});

test('buildUpdate: prepend', t => {
  const result = buildUpdate({}, {arrayOps: [{op: 'prepend', path: 'tags', values: ['first']}]});
  t.matchString(result.UpdateExpression, /list_append\(:upv1, if_not_exists\(#upk0, :upv0\)\)/);
});

test('buildUpdate: setAtIndex', t => {
  const result = buildUpdate({}, {arrayOps: [{op: 'setAtIndex', path: 'items', index: 3, value: 'x'}]});
  t.matchString(result.UpdateExpression, /#upk0\[3\] = :upv0/);
});

test('buildUpdate: removeAtIndex', t => {
  const result = buildUpdate({}, {arrayOps: [{op: 'removeAtIndex', path: 'items', index: 1}]});
  t.matchString(result.UpdateExpression, /REMOVE #upk0\[1\]/);
});

// buildUpdate — merge with existing params

test('buildUpdate: merges with existing params', t => {
  const existing = {
    ExpressionAttributeNames: {'#k0': 'pk'},
    ExpressionAttributeValues: {':v0': 'val'}
  };
  buildUpdate({x: 1}, {}, existing);
  t.equal(existing.ExpressionAttributeNames['#k0'], 'pk');
  t.equal(existing.ExpressionAttributeNames['#upk1'], 'x');
  t.equal(existing.ExpressionAttributeValues[':v0'], 'val');
  t.equal(existing.ExpressionAttributeValues[':upv1'], 1);
});

// addProjection

test('addProjection: simple fields', t => {
  const result = addProjection({}, ['name', 'climate']);
  t.matchString(result.ProjectionExpression, /#pj0,#pj1/);
  t.equal(result.ExpressionAttributeNames['#pj0'], 'name');
  t.equal(result.ExpressionAttributeNames['#pj1'], 'climate');
  t.equal(result.Select, 'SPECIFIC_ATTRIBUTES');
});

test('addProjection: deduplicates', t => {
  const result = addProjection({}, ['name', 'name', 'climate']);
  t.equal(result.ProjectionExpression.split(',').length, 2);
});

test('addProjection: nested path with array index', t => {
  const result = addProjection({}, ['items.0.name']);
  t.matchString(result.ProjectionExpression, /\[0\]/);
});

test('addProjection: null fields returns params unchanged', t => {
  const params = {existing: true};
  t.equal(addProjection(params, null), params);
});

test('addProjection: skipSelect', t => {
  const result = addProjection({}, ['name'], undefined, true);
  t.equal(result.Select, undefined);
});

test('addProjection: projectionFieldMap', t => {
  const result = addProjection({}, ['alias'], {alias: 'realName'});
  t.equal(result.ExpressionAttributeNames['#pj0'], 'realName');
});

// buildFilter

test('buildFilter: substring search across searchable fields', t => {
  const result = buildFilter({name: 1, climate: 1}, 'temp');
  t.matchString(result.FilterExpression, /contains\(#sr0, :flt0\) OR contains\(#sr1, :flt0\)/);
  t.equal(result.ExpressionAttributeNames['#sr0'], '-search-name');
  t.equal(result.ExpressionAttributeValues[':flt0'], 'temp');
});

test('buildFilter: case-insensitive by default', t => {
  const result = buildFilter({name: 1}, 'ABC');
  t.equal(result.ExpressionAttributeValues[':flt0'], 'abc');
});

test('buildFilter: case-sensitive option', t => {
  const result = buildFilter({name: 1}, 'ABC', {caseSensitive: true});
  t.equal(result.ExpressionAttributeValues[':flt0'], 'ABC');
});

test('buildFilter: null query returns params unchanged', t => {
  const params = {};
  t.equal(buildFilter({name: 1}, null, undefined, params), params);
});

test('buildFilter: field restriction', t => {
  const result = buildFilter({name: 1, climate: 1, terrain: 1}, 'test', {fields: ['name']});
  t.matchString(result.FilterExpression, /contains\(#sr0, :flt0\)/);
  t.notOk(result.FilterExpression.includes('OR'));
});

test('buildFilter: merges with existing FilterExpression', t => {
  const result = buildFilter({name: 1}, 'test', undefined, {FilterExpression: '#x = :x'});
  t.matchString(result.FilterExpression, /^\(#x = :x\) AND \(/);
});

// buildFilterByExample

test('buildFilterByExample: equality filter from object', t => {
  const result = buildFilterByExample({status: 'active', type: 'planet'});
  t.matchString(result.FilterExpression, /#fbe0 = :fbe0 AND #fbe1 = :fbe1/);
  t.equal(result.ExpressionAttributeNames['#fbe0'], 'status');
  t.equal(result.ExpressionAttributeValues[':fbe0'], 'active');
});

test('buildFilterByExample: empty object returns params unchanged', t => {
  const params = {};
  t.equal(buildFilterByExample({}, params), params);
});

// buildCondition

test('buildCondition: equality', t => {
  const result = buildCondition([{path: 'status', op: '=', value: 'active'}]);
  t.matchString(result.ConditionExpression, /#cd0 = :cdv0/);
  t.equal(result.ExpressionAttributeValues[':cdv0'], 'active');
});

test('buildCondition: exists / notExists', t => {
  const result = buildCondition([
    {path: 'email', op: 'exists'},
    {path: 'deleted', op: 'notExists'}
  ]);
  t.matchString(result.ConditionExpression, /attribute_exists\(#cd0\)/);
  t.matchString(result.ConditionExpression, /attribute_not_exists\(#cd1\)/);
});

test('buildCondition: beginsWith', t => {
  const result = buildCondition([{path: 'name', op: 'beginsWith', value: 'Al'}]);
  t.matchString(result.ConditionExpression, /begins_with\(#cd0, :cdv0\)/);
});

test('buildCondition: contains', t => {
  const result = buildCondition([{path: 'tags', op: 'contains', value: 'star'}]);
  t.matchString(result.ConditionExpression, /contains\(#cd0, :cdv0\)/);
});

test('buildCondition: in', t => {
  const result = buildCondition([{path: 'status', op: 'in', values: ['a', 'b', 'c']}]);
  t.matchString(result.ConditionExpression, /IN \(:cdv0, :cdv1, :cdv2\)/);
});

test('buildCondition: and/or/not composites', t => {
  const result = buildCondition([
    {
      op: 'or',
      clauses: [
        {path: 'a', op: '=', value: 1},
        {op: 'not', clause: {path: 'b', op: 'exists'}}
      ]
    }
  ]);
  t.matchString(result.ConditionExpression, /\(#cd0 = :cdv0 OR NOT \(attribute_exists\(#cd1\)\)\)/);
});

test('buildCondition: null/empty returns params unchanged', t => {
  const params = {};
  t.equal(buildCondition(null, params), params);
  t.equal(buildCondition([], params), params);
});

// cleanParams

test('cleanParams: removes unused names and values', t => {
  const params = {
    UpdateExpression: 'SET #upk0 = :upv0',
    ExpressionAttributeNames: {'#upk0': 'name', '#upk1': 'unused'},
    ExpressionAttributeValues: {':upv0': 'val', ':upv1': 'unused'}
  };
  cleanParams(params);
  t.deepEqual(Object.keys(params.ExpressionAttributeNames), ['#upk0']);
  t.deepEqual(Object.keys(params.ExpressionAttributeValues), [':upv0']);
});

test('cleanParams: deletes empty maps', t => {
  const params = {
    UpdateExpression: 'SET #a = :v',
    ExpressionAttributeNames: {},
    ExpressionAttributeValues: {}
  };
  cleanParams(params);
  t.equal(params.ExpressionAttributeNames, undefined);
  t.equal(params.ExpressionAttributeValues, undefined);
});

// cloneParams

test('cloneParams: shallow clones with maps', t => {
  const original = {
    TableName: 'test',
    ExpressionAttributeNames: {'#a': 'name'},
    ExpressionAttributeValues: {':v': 'val'}
  };
  const cloned = cloneParams(original);
  t.notEqual(cloned, original);
  t.notEqual(cloned.ExpressionAttributeNames, original.ExpressionAttributeNames);
  t.deepEqual(cloned, original);
});

test('cloneParams: null/undefined input returns fresh empty clone', t => {
  const a = cloneParams(null);
  t.deepEqual(a, {ExpressionAttributeNames: {}, ExpressionAttributeValues: {}});
  const b = cloneParams(undefined);
  t.deepEqual(b, {ExpressionAttributeNames: {}, ExpressionAttributeValues: {}});
});
