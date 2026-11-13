import { RenderGraph } from '../src/index.js';

export const MB = 1024 * 1024;

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(items, seed) {
  const rand = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function tex(name, overrides = {}) {
  return {
    name,
    type: 'texture',
    format: 'rgba8',
    size: MB,
    usage: ['sampled', 'render-target'],
    ...overrides,
  };
}

export function buf(name, overrides = {}) {
  return {
    name,
    type: 'buffer',
    format: 'raw',
    size: 4096,
    usage: ['storage'],
    ...overrides,
  };
}

export function buildGraph({ resources = [], passes = [] }, seed = 1) {
  const graph = new RenderGraph();
  for (const resource of shuffled(resources, seed)) graph.addResource(resource);
  for (const pass of shuffled(passes, seed + 1)) graph.addPass(pass);
  return graph;
}

export function diamondSpec() {
  return {
    resources: [
      tex('backbuffer', { storage: 'imported' }),
      tex('rA'),
      tex('rB'),
      tex('rC'),
    ],
    passes: [
      { name: 'A', queue: 'graphics', reads: [], writes: ['rA'] },
      { name: 'B', queue: 'graphics', reads: ['rA'], writes: ['rB'] },
      { name: 'C', queue: 'graphics', reads: ['rA'], writes: ['rC'] },
      { name: 'D', queue: 'graphics', reads: ['rB', 'rC'], writes: ['backbuffer'] },
    ],
  };
}
