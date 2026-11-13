import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/index.js';
import { buildGraph, tex, buf } from './helpers.js';

test('reports missing resource with pass and resource names', () => {
  const graph = buildGraph({
    resources: [tex('out', { storage: 'imported' })],
    passes: [
      { name: 'P1', queue: 'graphics', reads: ['ghost'], writes: ['out'] },
    ],
  });
  const result = compile(graph);
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.code === 'missing-resource');
  assert.ok(err, 'expected a missing-resource error');
  assert.deepEqual(err.passes, ['P1']);
  assert.deepEqual(err.resources, ['ghost']);
  assert.match(err.message, /P1/);
  assert.match(err.message, /ghost/);
});

test('reports parallel writes to the same resource', () => {
  const graph = buildGraph({
    resources: [tex('rX'), tex('out', { storage: 'imported' })],
    passes: [
      { name: 'P1', queue: 'graphics', reads: [], writes: ['rX'] },
      { name: 'P2', queue: 'compute', reads: [], writes: ['rX'] },
      { name: 'Sink', queue: 'graphics', reads: ['rX'], writes: ['out'] },
    ],
  });
  const result = compile(graph);
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.code === 'parallel-write');
  assert.ok(err, 'expected a parallel-write error');
  assert.deepEqual(err.passes, ['P1', 'P2']);
  assert.deepEqual(err.resources, ['rX']);
});

test('reports transient resource read but never written', () => {
  const graph = buildGraph({
    resources: [tex('rT'), tex('out', { storage: 'imported' })],
    passes: [
      { name: 'Reader', queue: 'graphics', reads: ['rT'], writes: ['out'] },
    ],
  });
  const result = compile(graph);
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.code === 'unclear-dependency');
  assert.ok(err, 'expected an unclear-dependency error');
  assert.deepEqual(err.resources, ['rT']);
  assert.deepEqual(err.passes, ['Reader']);
});

test('imported resource read without writer is allowed', () => {
  const graph = buildGraph({
    resources: [tex('external', { storage: 'imported' }), tex('out', { storage: 'imported' })],
    passes: [
      { name: 'Blit', queue: 'graphics', reads: ['external'], writes: ['out'] },
    ],
  });
  const result = compile(graph);
  assert.equal(result.ok, true);
});

test('reports dependency cycle with pass names', () => {
  const graph = buildGraph({
    resources: [tex('rA'), tex('rB')],
    passes: [
      { name: 'A', queue: 'graphics', reads: ['rB'], writes: ['rA'], sideEffect: true },
      { name: 'B', queue: 'graphics', reads: ['rA'], writes: ['rB'], sideEffect: true },
    ],
  });
  const result = compile(graph);
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.code === 'dependency-cycle');
  assert.ok(err, 'expected a dependency-cycle error');
  assert.deepEqual(err.passes, ['A', 'B']);
  assert.match(err.message, /A/);
  assert.match(err.message, /B/);
});

test('reports duplicate declarations', () => {
  const graph = buildGraph({
    resources: [tex('rA'), tex('out', { storage: 'imported' })],
    passes: [{ name: 'P', queue: 'graphics', reads: [], writes: ['out'] }],
  });
  graph.addResource(tex('rA'));
  graph.addPass({ name: 'P', queue: 'compute', reads: [], writes: ['out'] });
  const result = compile(graph);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'duplicate-resource' && e.resources.includes('rA')));
  assert.ok(result.errors.some((e) => e.code === 'duplicate-pass' && e.passes.includes('P')));
});

test('reports invalid descriptors', () => {
  const graph = buildGraph({
    resources: [buf('bad', { size: -1 }), tex('out', { storage: 'imported' })],
    passes: [{ name: 'P', queue: 'quantum', reads: [], writes: ['out'] }],
  });
  const result = compile(graph);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'invalid-descriptor' && e.resources?.includes('bad')));
  assert.ok(result.errors.some((e) => e.code === 'invalid-descriptor' && e.passes?.includes('P')));
});
