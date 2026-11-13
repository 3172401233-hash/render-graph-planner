import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/index.js';
import { buildGraph, diamondSpec, tex, shuffled } from './helpers.js';

test('diamond dependency produces canonical topological order', () => {
  const result = compile(buildGraph(diamondSpec()));
  assert.equal(result.ok, true);
  const order = result.plan.passes.map((p) => p.name);
  assert.deepEqual(order, ['A', 'B', 'C', 'D']);
});

test('plan is independent of declaration order and Map iteration order', () => {
  const spec = diamondSpec();
  const baseline = JSON.stringify(compile(buildGraph(spec, 1)).plan);
  for (const seed of [2, 7, 42, 1337]) {
    const result = compile(buildGraph(spec, seed));
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(result.plan), baseline, `seed ${seed} produced a different plan`);
  }
});

test('plan is independent of read/write declaration order within passes', () => {
  const spec = diamondSpec();
  const baseline = JSON.stringify(compile(buildGraph(spec, 1)).plan);
  const reordered = {
    resources: spec.resources,
    passes: spec.passes.map((pass) => ({
      ...pass,
      reads: shuffled(pass.reads, 99),
      writes: shuffled(pass.writes, 98),
    })),
  };
  const result = compile(buildGraph(reordered, 1));
  assert.equal(JSON.stringify(result.plan), baseline);
});

test('dead passes that do not affect external resources are culled', () => {
  const spec = diamondSpec();
  spec.resources.push(tex('rDead'), tex('rDead2'));
  spec.passes.push(
    { name: 'DeadA', queue: 'graphics', reads: [], writes: ['rDead'] },
    { name: 'DeadB', queue: 'compute', reads: ['rDead'], writes: ['rDead2'] },
  );
  const result = compile(buildGraph(spec));
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.passes.map((p) => p.name), ['A', 'B', 'C', 'D']);
  assert.deepEqual(result.plan.culledPasses, ['DeadA', 'DeadB']);
  assert.ok(!result.plan.lifetimes.some((l) => l.name === 'rDead' || l.name === 'rDead2'));
});

test('side-effect passes are kept even without external writes', () => {
  const spec = diamondSpec();
  spec.resources.push(tex('rScratch'));
  spec.passes.push({ name: 'Debug', queue: 'graphics', reads: [], writes: ['rScratch'], sideEffect: true });
  const result = compile(buildGraph(spec));
  assert.equal(result.ok, true);
  assert.ok(result.plan.passes.some((p) => p.name === 'Debug'));
  assert.deepEqual(result.plan.culledPasses, []);
});

test('lifetimes span first write to last read in execution order', () => {
  const result = compile(buildGraph(diamondSpec()));
  assert.equal(result.ok, true);
  const lifetimes = Object.fromEntries(result.plan.lifetimes.map((l) => [l.name, l]));
  assert.deepEqual({ first: lifetimes.rA.first, last: lifetimes.rA.last }, { first: 0, last: 2 });
  assert.deepEqual({ first: lifetimes.rB.first, last: lifetimes.rB.last }, { first: 1, last: 3 });
  assert.deepEqual({ first: lifetimes.rC.first, last: lifetimes.rC.last }, { first: 2, last: 3 });
  assert.ok(!('backbuffer' in lifetimes), 'imported resources have no transient lifetime');
});

test('plan is JSON serializable and stable across runs', () => {
  const graph = buildGraph(diamondSpec());
  const first = compile(graph);
  const second = compile(graph);
  assert.equal(first.ok, true);
  const roundTripped = JSON.parse(JSON.stringify(first.plan));
  assert.deepEqual(roundTripped, first.plan);
  assert.deepEqual(second.plan, first.plan);
});
