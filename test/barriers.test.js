import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/index.js';
import { buildGraph, tex } from './helpers.js';

function crossQueueSpec() {
  return {
    resources: [
      tex('out', { storage: 'imported' }),
      tex('tX'),
    ],
    passes: [
      { name: 'Produce', queue: 'graphics', reads: [], writes: [{ name: 'tX', layout: 'render-target' }] },
      { name: 'Copy', queue: 'transfer', reads: [{ name: 'tX', layout: 'transfer-src' }], writes: ['out'] },
    ],
  };
}

test('cross-queue handoff emits queue-transfer and layout-transition barrier', () => {
  const result = compile(buildGraph(crossQueueSpec()));
  assert.equal(result.ok, true);
  const barrier = result.plan.barriers.find((b) => b.resource === 'tX');
  assert.ok(barrier, 'expected a barrier for tX');
  assert.equal(barrier.beforePass, 'Copy');
  assert.ok(barrier.types.includes('queue-transfer'));
  assert.ok(barrier.types.includes('layout-transition'));
  assert.deepEqual(barrier.from, { queue: 'graphics', layout: 'render-target' });
  assert.deepEqual(barrier.to, { queue: 'transfer', layout: 'transfer-src' });
});

test('same-queue layout change emits only a layout transition', () => {
  const spec = crossQueueSpec();
  spec.passes[1] = { name: 'Shade', queue: 'graphics', reads: [{ name: 'tX', layout: 'shader-read' }], writes: ['out'] };
  const result = compile(buildGraph(spec));
  assert.equal(result.ok, true);
  const barrier = result.plan.barriers.find((b) => b.resource === 'tX');
  assert.deepEqual(barrier.types, ['layout-transition']);
  assert.deepEqual(barrier.from, { queue: 'graphics', layout: 'render-target' });
  assert.deepEqual(barrier.to, { queue: 'graphics', layout: 'shader-read' });
});

test('no barrier when queue and layout are unchanged', () => {
  const spec = {
    resources: [tex('out', { storage: 'imported' }), tex('tX')],
    passes: [
      { name: 'P1', queue: 'compute', reads: [], writes: [{ name: 'tX', layout: 'storage' }] },
      { name: 'P2', queue: 'compute', reads: [{ name: 'tX', layout: 'storage' }], writes: ['out'] },
    ],
  };
  const result = compile(buildGraph(spec));
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.barriers, []);
});

test('multi-queue chain emits one barrier per handoff in pass order', () => {
  const spec = {
    resources: [tex('out', { storage: 'imported' }), tex('tX')],
    passes: [
      { name: 'P1', queue: 'graphics', reads: [], writes: [{ name: 'tX', layout: 'render-target' }] },
      { name: 'P2', queue: 'compute', reads: [{ name: 'tX', layout: 'storage' }], writes: [] , sideEffect: true},
      { name: 'P3', queue: 'transfer', reads: [{ name: 'tX', layout: 'transfer-src' }], writes: ['out'] },
    ],
  };
  const result = compile(buildGraph(spec));
  assert.equal(result.ok, true);
  const barriers = result.plan.barriers.filter((b) => b.resource === 'tX');
  assert.equal(barriers.length, 2);
  assert.deepEqual(barriers[0].beforePass, 'P2');
  assert.deepEqual(barriers[0].from.queue, 'graphics');
  assert.deepEqual(barriers[0].to.queue, 'compute');
  assert.deepEqual(barriers[1].beforePass, 'P3');
  assert.deepEqual(barriers[1].from.queue, 'compute');
  assert.deepEqual(barriers[1].to.queue, 'transfer');
});

test('barrier sequence is deterministic regardless of declaration order', () => {
  const spec = {
    resources: [tex('out', { storage: 'imported' }), tex('tX'), tex('tY')],
    passes: [
      { name: 'P1', queue: 'graphics', reads: [], writes: [{ name: 'tX', layout: 'render-target' }, { name: 'tY', layout: 'render-target' }] },
      { name: 'P2', queue: 'compute', reads: [{ name: 'tX', layout: 'storage' }, { name: 'tY', layout: 'storage' }], writes: ['out'] },
    ],
  };
  const baseline = JSON.stringify(compile(buildGraph(spec, 5)).plan.barriers);
  for (const seed of [1, 2, 3, 77]) {
    assert.equal(JSON.stringify(compile(buildGraph(spec, seed)).plan.barriers), baseline);
  }
  const barriers = compile(buildGraph(spec, 5)).plan.barriers;
  assert.deepEqual(barriers.map((b) => b.resource), ['tX', 'tY']);
});
