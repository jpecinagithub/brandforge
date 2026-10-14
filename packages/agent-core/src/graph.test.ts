import { describe, expect, it } from 'vitest';
import { topologicalLevels, PlanGraphError } from './graph.js';
import type { PlanStep } from '@brandforge/shared';

function step(id: string, dependsOn: string[] = []): PlanStep {
  return { id, tool: 'create_campaign', title: id, args: {}, dependsOn };
}

describe('topologicalLevels', () => {
  it('groups independent steps into one level', () => {
    const levels = topologicalLevels([step('a'), step('b'), step('c')]);
    expect(levels).toHaveLength(1);
    expect(levels[0].map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('orders dependent steps into levels', () => {
    const levels = topologicalLevels([
      step('a'),
      step('b', ['a']),
      step('c', ['a']),
      step('d', ['b', 'c']),
    ]);
    expect(levels.map((l) => l.map((s) => s.id))).toEqual([
      ['a'],
      ['b', 'c'],
      ['d'],
    ]);
  });

  it('throws on cycles', () => {
    expect(() =>
      topologicalLevels([step('a', ['b']), step('b', ['a'])]),
    ).toThrow(PlanGraphError);
  });

  it('throws on unknown dependencies', () => {
    expect(() => topologicalLevels([step('a', ['zzz'])])).toThrow(
      PlanGraphError,
    );
  });

  it('throws on self-dependencies', () => {
    expect(() => topologicalLevels([step('a', ['a'])])).toThrow(PlanGraphError);
  });
});
