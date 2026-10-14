/**
 * DAG helpers for plan steps: topological levels (Kahn's algorithm) so the
 * orchestrator can run independent steps in parallel per level.
 */
import type { PlanStep } from '@brandforge/shared';

export class PlanGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanGraphError';
  }
}

/**
 * Groups steps into execution levels. Steps inside one level have no
 * dependencies between them and may run concurrently. Throws PlanGraphError
 * on unknown dependencies, self-dependencies or cycles.
 */
export function topologicalLevels(steps: PlanStep[]): PlanStep[][] {
  const byId = new Map<string, PlanStep>();
  for (const s of steps) {
    if (byId.has(s.id)) {
      throw new PlanGraphError(`Duplicate step id '${s.id}'`);
    }
    byId.set(s.id, s);
  }

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (dep === s.id) {
        throw new PlanGraphError(`Step '${s.id}' depends on itself`);
      }
      if (!byId.has(dep)) {
        throw new PlanGraphError(
          `Step '${s.id}' depends on unknown step '${dep}'`,
        );
      }
      dependents.set(dep, [...(dependents.get(dep) ?? []), s.id]);
    }
    indegree.set(s.id, s.dependsOn.length);
  }

  const levels: PlanStep[][] = [];
  let current = steps.filter((s) => (indegree.get(s.id) ?? 0) === 0);
  let visited = 0;
  while (current.length > 0) {
    levels.push(current);
    visited += current.length;
    const next: PlanStep[] = [];
    for (const s of current) {
      for (const dependentId of dependents.get(s.id) ?? []) {
        const remaining = (indegree.get(dependentId) ?? 1) - 1;
        indegree.set(dependentId, remaining);
        if (remaining === 0) {
          const dep = byId.get(dependentId);
          if (dep) next.push(dep);
        }
      }
    }
    current = next;
  }

  if (visited !== steps.length) {
    throw new PlanGraphError('Circular dependency detected in plan steps');
  }
  return levels;
}
