import { describe, expect, it } from 'vitest';
import { planRun, PlannerError } from './planner.js';
import { createDefaultRegistry } from './index.js';
import { FakeModelRouter, FakeOpenRouterClient } from './__tests__/fakes.js';
import type { ChatOptions, ChatResult } from './types.js';

const GOOD_PLAN = {
  steps: [
    {
      id: 's1',
      tool: 'create_campaign',
      title: 'Create campaign',
      args: { name: 'Launch', objective: 'Awareness' },
      dependsOn: [],
    },
    {
      id: 's2',
      tool: 'generate_marketing_copy',
      title: 'Write copy',
      args: { topic: 'Launch', channels: ['instagram'] },
      dependsOn: ['s1'],
    },
  ],
  estimatedCostUsd: 0.05,
};

function cannedClient(responses: string[]): FakeOpenRouterClient {
  let i = 0;
  const handler = async (o: ChatOptions): Promise<ChatResult> => ({
    content: responses[Math.min(i++, responses.length - 1)],
    model: o.model,
    usage: { tokensIn: 100, tokensOut: 200, costUsd: 0.001 },
    durationMs: 10,
  });
  return new FakeOpenRouterClient(handler);
}

const INPUT = {
  goal: 'Launch a campaign',
  language: 'en' as const,
  brandKitSummary: '',
  projectMemory: {},
  maxSteps: 10,
};

describe('planRun', () => {
  it('returns a validated AgentPlan from a canned model response', async () => {
    const client = cannedClient([JSON.stringify(GOOD_PLAN)]);
    const plan = await planRun(
      client,
      new FakeModelRouter(),
      createDefaultRegistry(),
      INPUT,
    );
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].tool).toBe('create_campaign');
    expect(plan.steps[1].dependsOn).toEqual(['s1']);
    expect(plan.estimatedCostUsd).toBe(0.05);
    expect(client.chatCalls).toHaveLength(1);
    expect(client.chatCalls[0].jsonMode).toBe(true);
  });

  it('retries once, then throws PlannerError on an invalid plan', async () => {
    const bad = JSON.stringify({
      steps: [
        { id: 's1', tool: 'nope_tool', title: 'x', args: {}, dependsOn: [] },
      ],
    });
    const client = cannedClient([bad, bad]);
    await expect(
      planRun(client, new FakeModelRouter(), createDefaultRegistry(), INPUT),
    ).rejects.toThrow(PlannerError);
    expect(client.chatCalls).toHaveLength(2); // exactly one retry
  });

  it('recovers when the retry returns a valid plan', async () => {
    const bad = JSON.stringify({ steps: [] }); // min(1) fails
    const client = cannedClient([bad, JSON.stringify(GOOD_PLAN)]);
    const plan = await planRun(
      client,
      new FakeModelRouter(),
      createDefaultRegistry(),
      INPUT,
    );
    expect(plan.steps).toHaveLength(2);
    expect(client.chatCalls).toHaveLength(2);
  });

  it('rejects plans with dependency cycles', async () => {
    const cyclic = JSON.stringify({
      steps: [
        { id: 's1', tool: 'create_campaign', title: 'a', args: { name: 'x' }, dependsOn: ['s2'] },
        { id: 's2', tool: 'create_campaign', title: 'b', args: { name: 'y' }, dependsOn: ['s1'] },
      ],
    });
    const client = cannedClient([cyclic, cyclic]);
    await expect(
      planRun(client, new FakeModelRouter(), createDefaultRegistry(), INPUT),
    ).rejects.toThrow(PlannerError);
  });

  it('rejects plans exceeding maxSteps', async () => {
    const tooLong = JSON.stringify({
      steps: Array.from({ length: 11 }, (_, i) => ({
        id: `s${i + 1}`,
        tool: 'create_campaign',
        title: `step ${i + 1}`,
        args: { name: `c${i + 1}` },
        dependsOn: [],
      })),
    });
    const client = cannedClient([tooLong, tooLong]);
    await expect(
      planRun(client, new FakeModelRouter(), createDefaultRegistry(), INPUT),
    ).rejects.toThrow(/maxSteps/);
  });

  it('rejects non-JSON output', async () => {
    const client = cannedClient(['not json at all', 'still not json']);
    await expect(
      planRun(client, new FakeModelRouter(), createDefaultRegistry(), INPUT),
    ).rejects.toThrow(PlannerError);
  });
});
