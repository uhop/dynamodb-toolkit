import test from 'tape-six';
import {getPath, setPath, deletePath, applyPatch, normalizeFields, subsetObject} from 'dynamodb-toolkit/paths';

// getPath

test('getPath: shallow property', t => {
  t.equal(getPath({a: 1}, 'a'), 1);
});

test('getPath: nested dotted path', t => {
  t.equal(getPath({a: {b: {c: 42}}}, 'a.b.c'), 42);
});

test('getPath: array index as string', t => {
  t.equal(getPath({items: ['x', 'y', 'z']}, 'items.1'), 'y');
});

test('getPath: missing path returns defaultValue', t => {
  t.equal(getPath({a: 1}, 'b.c', 'nope'), 'nope');
});

test('getPath: null intermediate returns defaultValue', t => {
  t.equal(getPath({a: null}, 'a.b', 'nope'), 'nope');
});

test('getPath: custom separator', t => {
  t.equal(getPath({a: {b: 3}}, 'a/b', undefined, '/'), 3);
});

test('getPath: pre-split path array', t => {
  t.equal(getPath({a: {b: 5}}, ['a', 'b']), 5);
});

// setPath

test('setPath: shallow', t => {
  const o = {};
  setPath(o, 'x', 10);
  t.deepEqual(o, {x: 10});
});

test('setPath: nested creates intermediates', t => {
  const o = {};
  setPath(o, 'a.b.c', 42);
  t.deepEqual(o, {a: {b: {c: 42}}});
});

test('setPath: overwrites existing leaf', t => {
  const o = {a: {b: 1}};
  setPath(o, 'a.b', 2);
  t.equal(o.a.b, 2);
});

test('setPath: overwrites non-object intermediate', t => {
  const o = {a: 'string'};
  setPath(o, 'a.b', 1);
  t.deepEqual(o, {a: {b: 1}});
});

test('setPath: custom separator', t => {
  const o = {};
  setPath(o, 'a/b', 1, '/');
  t.deepEqual(o, {a: {b: 1}});
});

// deletePath

test('deletePath: shallow', t => {
  const o = {a: 1, b: 2};
  t.ok(deletePath(o, 'a'));
  t.deepEqual(o, {b: 2});
});

test('deletePath: nested', t => {
  const o = {a: {b: 1, c: 2}};
  t.ok(deletePath(o, 'a.b'));
  t.deepEqual(o, {a: {c: 2}});
});

test('deletePath: missing intermediate returns false', t => {
  t.notOk(deletePath({a: 1}, 'x.y.z'));
});

test('deletePath: non-object intermediate returns false', t => {
  t.notOk(deletePath({a: 'str'}, 'a.b'));
});

// Prototype-pollution guards

test('setPath: refuses __proto__ segment', t => {
  const o = {};
  setPath(o, '__proto__.polluted', 'x');
  t.notOk(o.polluted, 'own property unchanged');
  t.notOk(Object.prototype.polluted, 'Object.prototype not polluted');
  // cleanup just in case
  delete Object.prototype.polluted;
});

test('setPath: refuses constructor.prototype segment', t => {
  const o = {};
  setPath(o, 'constructor.prototype.polluted', 'x');
  t.notOk({}.polluted, 'Object.prototype not polluted');
  delete Object.prototype.polluted;
});

test('setPath: refuses __proto__ as final segment', t => {
  const o = {};
  setPath(o, '__proto__', 'x');
  t.equal(Object.getPrototypeOf(o), Object.prototype, 'prototype unchanged');
});

test('deletePath: refuses __proto__ segment', t => {
  const o = {};
  t.notOk(deletePath(o, '__proto__.toString'));
  t.equal(typeof {}.toString, 'function', 'Object.prototype.toString intact');
});

test('deletePath: refuses constructor.prototype segment', t => {
  t.notOk(deletePath({}, 'constructor.prototype.toString'));
  t.equal(typeof {}.toString, 'function', 'Object.prototype.toString intact');
});

// applyPatch

test('applyPatch: sets fields', t => {
  const o = {a: 1};
  applyPatch(o, {b: 2, c: 3});
  t.deepEqual(o, {a: 1, b: 2, c: 3});
});

test('applyPatch: deletes paths via options', t => {
  const o = {a: 1, b: 2, c: 3};
  applyPatch(o, {d: 4}, {delete: ['a', 'c']});
  t.deepEqual(o, {b: 2, d: 4});
});

test('applyPatch: custom separator', t => {
  const o = {};
  applyPatch(o, {'a/b': 1}, {separator: '/'});
  t.deepEqual(o, {a: {b: 1}});
});

test('applyPatch: nested set + delete', t => {
  const o = {config: {x: 1, y: 2}};
  applyPatch(o, {'config.z': 3}, {delete: ['config.x']});
  t.deepEqual(o, {config: {y: 2, z: 3}});
});

// normalizeFields

test('normalizeFields: null/undefined returns null', t => {
  t.equal(normalizeFields(null), null);
  t.equal(normalizeFields(undefined), null);
});

test('normalizeFields: string splits on comma', t => {
  t.deepEqual(normalizeFields('a, b, c'), ['a', 'b', 'c']);
});

test('normalizeFields: array passthrough', t => {
  const arr = ['x', 'y'];
  t.equal(normalizeFields(arr), arr);
});

test('normalizeFields: object extracts keys', t => {
  t.deepEqual(normalizeFields({a: 1, b: 2}), ['a', 'b']);
});

test('normalizeFields: projectionFieldMap remaps top-level', t => {
  t.deepEqual(normalizeFields(['name', 'config.x'], {name: 'n'}), ['n', 'config.x']);
});

test('normalizeFields: projectionFieldMap with nested path', t => {
  t.deepEqual(normalizeFields(['data.value'], {data: 'd'}), ['d.value']);
});

// subsetObject

test('subsetObject: null fields returns original', t => {
  const o = {a: 1, b: 2};
  t.equal(subsetObject(o, null), o);
});

test('subsetObject: picks specified fields', t => {
  const o = {a: 1, b: 2, c: 3};
  t.deepEqual(subsetObject(o, ['a', 'c']), {a: 1, c: 3});
});

test('subsetObject: handles nested paths', t => {
  const o = {config: {x: 1, y: 2}, name: 'test'};
  t.deepEqual(subsetObject(o, ['config.x', 'name']), {config: {x: 1}, name: 'test'});
});

test('subsetObject: missing paths are silently skipped', t => {
  const o = {a: 1};
  t.deepEqual(subsetObject(o, ['a', 'missing']), {a: 1});
});

test('subsetObject: string fields', t => {
  const o = {a: 1, b: 2, c: 3};
  t.deepEqual(subsetObject(o, 'a, c'), {a: 1, c: 3});
});
