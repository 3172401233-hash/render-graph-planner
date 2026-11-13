function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collectAccesses(graph, order) {
  const indexOf = new Map(order.map((name, index) => [name, index]));
  const accessesByResource = new Map();

  const record = (resourceName, entry) => {
    if (!accessesByResource.has(resourceName)) accessesByResource.set(resourceName, []);
    accessesByResource.get(resourceName).push(entry);
  };

  for (const passName of order) {
    const pass = graph.passes.get(passName);
    const index = indexOf.get(passName);
    const writeLayouts = new Map(pass.writes.map((a) => [a.name, a.layout]));
    for (const access of pass.reads) {
      if (writeLayouts.has(access.name)) continue;
      record(access.name, { pass: passName, index, queue: pass.queue, kind: 'read', layout: access.layout });
    }
    for (const access of pass.writes) {
      record(access.name, { pass: passName, index, queue: pass.queue, kind: 'write', layout: access.layout });
    }
  }

  for (const accesses of accessesByResource.values()) {
    accesses.sort((a, b) => a.index - b.index || compareNames(a.pass, b.pass));
  }
  return accessesByResource;
}

export function computeBarriers(graph, order) {
  const accessesByResource = collectAccesses(graph, order);
  const barriers = [];

  for (const resourceName of [...accessesByResource.keys()].sort(compareNames)) {
    const accesses = accessesByResource.get(resourceName);
    for (let i = 1; i < accesses.length; i += 1) {
      const from = accesses[i - 1];
      const to = accesses[i];
      const types = [];
      if (from.layout !== to.layout) types.push('layout-transition');
      if (from.queue !== to.queue) types.push('queue-transfer');
      if (types.length === 0) continue;
      barriers.push({
        resource: resourceName,
        beforePass: to.pass,
        passIndex: to.index,
        types,
        from: { queue: from.queue, layout: from.layout },
        to: { queue: to.queue, layout: to.layout },
      });
    }
  }

  barriers.sort((a, b) => a.passIndex - b.passIndex || compareNames(a.resource, b.resource));
  return barriers.map(({ passIndex, ...barrier }) => barrier);
}
