function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function alignUp(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

export function canAlias(a, b) {
  if (a.type !== b.type) return false;
  if (a.format !== b.format) return false;
  if (a.usage.join('|') !== b.usage.join('|')) return false;
  if (a.queues.join('|') !== b.queues.join('|')) return false;
  return true;
}

export function lifetimesOverlap(a, b) {
  return a.first <= b.last && b.first <= a.last;
}

export function allocateAliases(graph, lifetimes) {
  const lifetimeByName = new Map(lifetimes.map((entry) => [entry.name, entry]));
  const candidates = lifetimes
    .map((entry) => ({ lifetime: entry, resource: graph.resources.get(entry.name) }))
    .sort((a, b) => {
      if (a.resource.size !== b.resource.size) return b.resource.size - a.resource.size;
      return compareNames(a.resource.name, b.resource.name);
    });

  const groups = [];
  for (const { lifetime, resource } of candidates) {
    let placed = null;
    for (const group of groups) {
      const compatible = group.members.every((member) => {
        return canAlias(member.resource, resource) && !lifetimesOverlap(member.lifetime, lifetime);
      });
      if (compatible) {
        placed = group;
        break;
      }
    }
    if (!placed) {
      placed = { members: [], size: 0, alignment: 1 };
      groups.push(placed);
    }
    placed.members.push({ resource, lifetime });
    placed.size = Math.max(placed.size, resource.size);
    placed.alignment = Math.max(placed.alignment, resource.alignment);
  }

  let totalMemory = 0;
  const aliasGroups = groups.map((group, id) => {
    const offset = alignUp(totalMemory, group.alignment);
    totalMemory = offset + alignUp(group.size, group.alignment);
    return {
      id,
      offset,
      size: group.size,
      alignment: group.alignment,
      resources: group.members.map((member) => member.resource.name).sort(compareNames),
    };
  });

  const groupOf = new Map();
  for (const group of aliasGroups) {
    for (const name of group.resources) groupOf.set(name, group);
  }

  const assignments = lifetimes.map((entry) => {
    const group = groupOf.get(entry.name);
    return {
      name: entry.name,
      group: group.id,
      offset: group.offset,
      size: graph.resources.get(entry.name).size,
    };
  });

  return { aliasGroups, assignments, totalMemory, lifetimeByName };
}
