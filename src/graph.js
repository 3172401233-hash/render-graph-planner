export const QUEUES = Object.freeze(['graphics', 'compute', 'transfer']);
export const STORAGE = Object.freeze(['transient', 'imported', 'persistent']);
export const RESOURCE_TYPES = Object.freeze(['texture', 'buffer']);

export const DEFAULT_ALIGNMENT = 256;

function normalizeStringList(value, fallback) {
  if (value === undefined || value === null) return [...fallback];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map(String))].sort();
}

export function normalizeResource(desc) {
  return {
    name: String(desc.name),
    type: desc.type,
    format: String(desc.format),
    size: Number(desc.size),
    usage: normalizeStringList(desc.usage, []),
    storage: desc.storage === undefined ? 'transient' : String(desc.storage),
    queues: normalizeStringList(desc.queues, QUEUES),
    alignment: desc.alignment === undefined ? DEFAULT_ALIGNMENT : Number(desc.alignment),
  };
}

export function normalizeAccess(access, kind) {
  if (typeof access === 'string') {
    return { name: access, layout: kind === 'write' ? 'write' : 'read' };
  }
  return {
    name: String(access.name),
    layout: access.layout === undefined ? (kind === 'write' ? 'write' : 'read') : String(access.layout),
  };
}

export function normalizePass(desc) {
  const reads = (desc.reads ?? []).map((a) => normalizeAccess(a, 'read'));
  const writes = (desc.writes ?? []).map((a) => normalizeAccess(a, 'write'));
  reads.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  writes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    name: String(desc.name),
    queue: String(desc.queue),
    reads,
    writes,
    sideEffect: desc.sideEffect === true,
  };
}

export class RenderGraph {
  constructor() {
    this.resources = new Map();
    this.passes = new Map();
    this.duplicateResources = [];
    this.duplicatePasses = [];
  }

  addResource(desc) {
    const resource = normalizeResource(desc);
    if (this.resources.has(resource.name)) this.duplicateResources.push(resource.name);
    this.resources.set(resource.name, resource);
    return this;
  }

  addPass(desc) {
    const pass = normalizePass(desc);
    if (this.passes.has(pass.name)) this.duplicatePasses.push(pass.name);
    this.passes.set(pass.name, pass);
    return this;
  }
}
