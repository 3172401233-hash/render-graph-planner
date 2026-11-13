import { validateGraph } from './validate.js';
import { buildDependencies, topoSort, findCycle, cullDeadPasses, computeLifetimes } from './schedule.js';
import { allocateAliases } from './memory.js';
import { computeBarriers } from './barriers.js';

function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compile(graph) {
  const errors = validateGraph(graph);

  const passNames = [...graph.passes.keys()].sort(compareNames);
  const { successors, predecessors } = buildDependencies(graph);
  const { order, remaining } = topoSort(passNames, successors);

  if (remaining.length > 0) {
    const cycle = findCycle(remaining, successors);
    errors.push({
      code: 'dependency-cycle',
      message: `dependency cycle detected among passes: ${cycle.join(' -> ')}`,
      passes: [...new Set(cycle)].sort(compareNames),
      cycle,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const needed = cullDeadPasses(graph, predecessors);
  const finalOrder = order.filter((name) => needed.has(name));
  const culledPasses = order.filter((name) => !needed.has(name)).sort(compareNames);

  const lifetimes = computeLifetimes(graph, finalOrder);
  const { aliasGroups, assignments, totalMemory } = allocateAliases(graph, lifetimes);
  const barriers = computeBarriers(graph, finalOrder);

  const assignmentByName = new Map(assignments.map((a) => [a.name, a]));

  const plan = {
    passes: finalOrder.map((name) => {
      const pass = graph.passes.get(name);
      return {
        name: pass.name,
        queue: pass.queue,
        reads: pass.reads.map((a) => ({ ...a })),
        writes: pass.writes.map((a) => ({ ...a })),
      };
    }),
    culledPasses,
    lifetimes: lifetimes.map((entry) => ({
      name: entry.name,
      first: entry.first,
      last: entry.last,
      aliasGroup: assignmentByName.get(entry.name).group,
      offset: assignmentByName.get(entry.name).offset,
    })),
    aliasGroups,
    barriers,
    totalMemory,
  };

  return { ok: true, plan };
}
