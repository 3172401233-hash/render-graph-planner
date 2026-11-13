function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildDependencies(graph) {
  const writerOf = new Map();
  const readersOf = new Map();
  for (const name of [...graph.passes.keys()].sort(compareNames)) {
    const pass = graph.passes.get(name);
    for (const access of pass.writes) writerOf.set(access.name, pass.name);
    for (const access of pass.reads) {
      if (!readersOf.has(access.name)) readersOf.set(access.name, []);
      readersOf.get(access.name).push(pass.name);
    }
  }

  const successors = new Map();
  const predecessors = new Map();
  for (const name of graph.passes.keys()) {
    successors.set(name, new Set());
    predecessors.set(name, new Set());
  }
  for (const [resourceName, readers] of readersOf) {
    const writer = writerOf.get(resourceName);
    if (!writer) continue;
    for (const reader of readers) {
      if (reader === writer) continue;
      successors.get(writer).add(reader);
      predecessors.get(reader).add(writer);
    }
  }
  return { successors, predecessors, writerOf, readersOf };
}

export function topoSort(passNames, successors) {
  const indegree = new Map();
  for (const name of passNames) indegree.set(name, 0);
  for (const [, succs] of successors) {
    for (const succ of succs) indegree.set(succ, indegree.get(succ) + 1);
  }

  const ready = passNames.filter((name) => indegree.get(name) === 0).sort(compareNames);
  const order = [];
  while (ready.length > 0) {
    const name = ready.shift();
    order.push(name);
    const promoted = [];
    for (const succ of [...successors.get(name)].sort(compareNames)) {
      indegree.set(succ, indegree.get(succ) - 1);
      if (indegree.get(succ) === 0) promoted.push(succ);
    }
    if (promoted.length > 0) {
      ready.push(...promoted);
      ready.sort(compareNames);
    }
  }

  const remaining = passNames.filter((name) => indegree.get(name) > 0).sort(compareNames);
  return { order, remaining };
}

export function findCycle(remaining, successors) {
  const inRemaining = new Set(remaining);
  const state = new Map();
  const stack = [];
  for (const start of remaining) {
    if (state.has(start)) continue;
    const dfs = (node) => {
      state.set(node, 'visiting');
      stack.push(node);
      for (const succ of [...successors.get(node)].sort(compareNames)) {
        if (!inRemaining.has(succ)) continue;
        if (state.get(succ) === 'visiting') {
          return stack.slice(stack.indexOf(succ)).concat(succ);
        }
        if (!state.has(succ)) {
          const found = dfs(succ);
          if (found) return found;
        }
      }
      stack.pop();
      state.set(node, 'done');
      return null;
    };
    const found = dfs(start);
    if (found) return found;
  }
  return [...remaining].sort(compareNames);
}

export function cullDeadPasses(graph, predecessors) {
  const needed = new Set();
  const worklist = [];
  for (const name of [...graph.passes.keys()].sort(compareNames)) {
    const pass = graph.passes.get(name);
    const writesExternal = pass.writes.some((access) => {
      const resource = graph.resources.get(access.name);
      return resource && resource.storage !== 'transient';
    });
    if (pass.sideEffect || writesExternal) {
      needed.add(name);
      worklist.push(name);
    }
  }
  while (worklist.length > 0) {
    const name = worklist.pop();
    for (const pred of predecessors.get(name)) {
      if (!needed.has(pred)) {
        needed.add(pred);
        worklist.push(pred);
      }
    }
  }
  return needed;
}

export function computeLifetimes(graph, order) {
  const indexOf = new Map(order.map((name, index) => [name, index]));
  const lifetimes = new Map();

  const touch = (resourceName, index, isWrite) => {
    const resource = graph.resources.get(resourceName);
    if (!resource || resource.storage !== 'transient') return;
    if (!lifetimes.has(resourceName)) {
      lifetimes.set(resourceName, { name: resourceName, first: Infinity, last: -Infinity, firstWrite: Infinity });
    }
    const entry = lifetimes.get(resourceName);
    entry.first = Math.min(entry.first, index);
    entry.last = Math.max(entry.last, index);
    if (isWrite) entry.firstWrite = Math.min(entry.firstWrite, index);
  };

  for (const passName of order) {
    const pass = graph.passes.get(passName);
    const index = indexOf.get(passName);
    for (const access of pass.writes) touch(access.name, index, true);
    for (const access of pass.reads) touch(access.name, index, false);
  }

  return [...lifetimes.values()]
    .map((entry) => ({
      name: entry.name,
      first: entry.firstWrite === Infinity ? entry.first : entry.firstWrite,
      last: entry.last,
    }))
    .sort((a, b) => compareNames(a.name, b.name));
}
