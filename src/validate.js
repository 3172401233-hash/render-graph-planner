import { QUEUES, RESOURCE_TYPES, STORAGE } from './graph.js';

function error(code, message, details = {}) {
  return { code, message, ...details };
}

function sortedNames(map) {
  return [...map.keys()].sort();
}

export function validateGraph(graph) {
  const errors = [];

  for (const name of [...graph.duplicateResources].sort()) {
    errors.push(error('duplicate-resource', `resource "${name}" is declared more than once`, { resources: [name] }));
  }
  for (const name of [...graph.duplicatePasses].sort()) {
    errors.push(error('duplicate-pass', `pass "${name}" is declared more than once`, { passes: [name] }));
  }

  const resourceNames = new Set();
  for (const name of sortedNames(graph.resources)) {
    const resource = graph.resources.get(name);
    resourceNames.add(name);
    if (!RESOURCE_TYPES.includes(resource.type)) {
      errors.push(error('invalid-descriptor', `resource "${name}" has invalid type "${resource.type}"`, { resources: [name] }));
    }
    if (!STORAGE.includes(resource.storage)) {
      errors.push(error('invalid-descriptor', `resource "${name}" has invalid storage "${resource.storage}"`, { resources: [name] }));
    }
    if (!Number.isFinite(resource.size) || resource.size <= 0) {
      errors.push(error('invalid-descriptor', `resource "${name}" has invalid size ${resource.size}`, { resources: [name] }));
    }
    if (!Number.isInteger(resource.alignment) || resource.alignment <= 0) {
      errors.push(error('invalid-descriptor', `resource "${name}" has invalid alignment ${resource.alignment}`, { resources: [name] }));
    }
    for (const queue of resource.queues) {
      if (!QUEUES.includes(queue)) {
        errors.push(error('invalid-descriptor', `resource "${name}" allows unknown queue "${queue}"`, { resources: [name] }));
      }
    }
  }

  const passNames = new Set();
  for (const name of sortedNames(graph.passes)) {
    passNames.add(name);
    const pass = graph.passes.get(name);
    if (!QUEUES.includes(pass.queue)) {
      errors.push(error('invalid-descriptor', `pass "${name}" uses unknown queue "${pass.queue}"`, { passes: [name] }));
    }
    for (const access of [...pass.reads, ...pass.writes]) {
      if (!graph.resources.has(access.name)) {
        errors.push(error('missing-resource', `pass "${pass.name}" references undeclared resource "${access.name}"`, {
          passes: [pass.name],
          resources: [access.name],
        }));
      }
    }
  }

  const writers = new Map();
  const readers = new Map();
  for (const name of sortedNames(graph.passes)) {
    const pass = graph.passes.get(name);
    for (const access of pass.writes) {
      if (!writers.has(access.name)) writers.set(access.name, []);
      writers.get(access.name).push(pass.name);
    }
    for (const access of pass.reads) {
      if (!readers.has(access.name)) readers.set(access.name, []);
      readers.get(access.name).push(pass.name);
    }
  }

  for (const name of [...writers.keys()].sort()) {
    const passes = writers.get(name);
    if (passes.length > 1) {
      errors.push(error('parallel-write', `resource "${name}" is written by multiple passes with no defined order: ${passes.join(', ')}`, {
        passes: [...passes].sort(),
        resources: [name],
      }));
    }
  }

  for (const name of [...readers.keys()].sort()) {
    if (!graph.resources.has(name)) continue;
    const resource = graph.resources.get(name);
    const hasWriter = (writers.get(name) ?? []).length > 0;
    if (!hasWriter && resource.storage === 'transient') {
      errors.push(error('unclear-dependency', `transient resource "${name}" is read by ${readers.get(name).join(', ')} but never written`, {
        passes: [...readers.get(name)].sort(),
        resources: [name],
      }));
    }
  }

  return errors;
}
