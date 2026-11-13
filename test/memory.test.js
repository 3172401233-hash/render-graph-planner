import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/index.js';
import { buildGraph, tex, MB } from './helpers.js';

function twoChainsSpec({ t1 = {}, t2 = {}, interleaved = false, extraResources = [] } = {}) {
  const passes = interleaved
    ? [
        { name: 'P1', queue: 'graphics', reads: [], writes: ['t1'] },
        { name: 'P2', queue: 'graphics', reads: [], writes: ['t2'] },
        { name: 'P3', queue: 'graphics', reads: ['t1'], writes: ['out1'] },
        { name: 'P4', queue: 'graphics', reads: ['t2'], writes: ['out2'] },
      ]
    : [
        { name: 'P1', queue: 'graphics', reads: [], writes: ['t1'] },
        { name: 'P2', queue: 'graphics', reads: ['t1'], writes: ['out1'] },
        { name: 'P3', queue: 'graphics', reads: [], writes: ['t2'] },
        { name: 'P4', queue: 'graphics', reads: ['t2'], writes: ['out2'] },
      ];
  return {
    resources: [
      tex('out1', { storage: 'imported' }),
      tex('out2', { storage: 'imported' }),
      tex('t1', t1),
      tex('t2', t2),
      ...extraResources,
    ],
    passes,
  };
}

function lifetimeOf(plan, name) {
  return plan.lifetimes.find((l) => l.name === name);
}

test('disjoint lifetimes share one alias group and one allocation', () => {
  const result = compile(buildGraph(twoChainsSpec()));
  assert.equal(result.ok, true);
  const t1 = lifetimeOf(result.plan, 't1');
  const t2 = lifetimeOf(result.plan, 't2');
  assert.equal(t1.aliasGroup, t2.aliasGroup);
  assert.equal(t1.offset, t2.offset);
  assert.equal(result.plan.aliasGroups.length, 1);
  assert.equal(result.plan.totalMemory, MB);
});

test('overlapping lifetimes never share storage', () => {
  const result = compile(buildGraph(twoChainsSpec({ interleaved: true })));
  assert.equal(result.ok, true);
  const t1 = lifetimeOf(result.plan, 't1');
  const t2 = lifetimeOf(result.plan, 't2');
  assert.ok(t1.first <= t2.last && t2.first <= t1.last, 'lifetimes must overlap in this fixture');
  assert.notEqual(t1.aliasGroup, t2.aliasGroup);
  assert.equal(result.plan.totalMemory, 2 * MB);
});

test('different formats cannot alias even with disjoint lifetimes', () => {
  const result = compile(buildGraph(twoChainsSpec({ t2: { format: 'rgba16f' } })));
  assert.equal(result.ok, true);
  assert.notEqual(lifetimeOf(result.plan, 't1').aliasGroup, lifetimeOf(result.plan, 't2').aliasGroup);
  assert.equal(result.plan.totalMemory, 2 * MB);
});

test('different usage cannot alias', () => {
  const result = compile(buildGraph(twoChainsSpec({ t2: { usage: ['storage'] } })));
  assert.equal(result.ok, true);
  assert.notEqual(lifetimeOf(result.plan, 't1').aliasGroup, lifetimeOf(result.plan, 't2').aliasGroup);
});

test('different queue constraints cannot alias', () => {
  const result = compile(buildGraph(twoChainsSpec({ t2: { queues: ['graphics'] } })));
  assert.equal(result.ok, true);
  assert.notEqual(lifetimeOf(result.plan, 't1').aliasGroup, lifetimeOf(result.plan, 't2').aliasGroup);
});

test('different resource types cannot alias', () => {
  const result = compile(buildGraph(twoChainsSpec({ t2: { type: 'buffer', format: 'rgba8' } })));
  assert.equal(result.ok, true);
  assert.notEqual(lifetimeOf(result.plan, 't1').aliasGroup, lifetimeOf(result.plan, 't2').aliasGroup);
});

test('imported and persistent resources stay out of the alias pool', () => {
  const spec = twoChainsSpec({
    extraResources: [
      tex('persist', { storage: 'persistent' }),
      tex('out3', { storage: 'imported' }),
    ],
  });
  spec.passes.push({ name: 'P5', queue: 'graphics', reads: ['persist'], writes: ['out3'] });
  const result = compile(buildGraph(spec));
  assert.equal(result.ok, true);
  const pooled = result.plan.aliasGroups.flatMap((g) => g.resources);
  assert.ok(!pooled.includes('persist'));
  assert.ok(!pooled.includes('out1'));
  assert.ok(!pooled.includes('out2'));
  assert.equal(result.plan.totalMemory, MB, 'external resources must not add to transient memory');
});

test('smaller resource reuses larger group storage', () => {
  const result = compile(buildGraph(twoChainsSpec({ t1: { size: 2 * MB } })));
  assert.equal(result.ok, true);
  assert.equal(result.plan.aliasGroups.length, 1);
  assert.equal(result.plan.aliasGroups[0].size, 2 * MB);
  assert.equal(result.plan.totalMemory, 2 * MB);
});

test('offsets satisfy alignment requirements', () => {
  const spec = twoChainsSpec({
    interleaved: true,
    t1: { size: 1000, alignment: 256 },
    t2: { size: 500, alignment: 4096 },
  });
  const result = compile(buildGraph(spec));
  assert.equal(result.ok, true);
  for (const group of result.plan.aliasGroups) {
    assert.equal(group.offset % group.alignment, 0, `group ${group.id} offset must be aligned`);
  }
  const byName = Object.fromEntries(result.plan.lifetimes.map((l) => [l.name, l]));
  assert.equal(byName.t1.offset, 0);
  assert.equal(byName.t2.offset, 4096);
  assert.equal(result.plan.totalMemory, 8192);
});

test('diamond graph aliases nothing when all lifetimes overlap', () => {
  const result = compile(buildGraph({
    resources: [
      tex('backbuffer', { storage: 'imported' }),
      tex('rA'), tex('rB'), tex('rC'),
    ],
    passes: [
      { name: 'A', queue: 'graphics', reads: [], writes: ['rA'] },
      { name: 'B', queue: 'graphics', reads: ['rA'], writes: ['rB'] },
      { name: 'C', queue: 'graphics', reads: ['rA'], writes: ['rC'] },
      { name: 'D', queue: 'graphics', reads: ['rB', 'rC'], writes: ['backbuffer'] },
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.plan.aliasGroups.length, 3);
  assert.equal(result.plan.totalMemory, 3 * MB);
});
