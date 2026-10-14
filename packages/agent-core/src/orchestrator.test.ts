import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORCHESTRATOR_CONFIG,
  Orchestrator,
} from './orchestrator.js';
import { createDefaultRegistry } from './tools/index.js';
import {
  createFakeBudget,
  createFakeConversation,
  createFakeDb,
  createFakeEmitter,
  createFakeMemory,
  createFakeStorage,
  FakeModelRouter,
  FakeOpenRouterClient,
} from './__tests__/fakes.js';
import type {
  FakeBudget,
  FakeConversation,
  FakeDb,
  FakeEmitter,
} from './__tests__/fakes.js';
import type { Db } from '@brandforge/database';
import type {
  ChatOptions,
  ChatResult,
  OrchestratorDeps,
} from './types.js';

const PROJECT_ROW = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'Project',
  description: '',
  isFavorite: false,
  createdAt: new Date(),
  updatedAt: null,
};

const COPY_PLAN = {
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

interface Setup {
  db: Db & FakeDb;
  budget: FakeBudget;
  conversation: FakeConversation;
  emitter: FakeEmitter;
  memoryProject: Map<string, Record<string, unknown>>;
  orch: Orchestrator;
}

function setup(
  plan: unknown,
  opts: { affordable?: boolean; budgetReason?: string } = {},
): Setup {
  const db = createFakeDb({ projects: [PROJECT_ROW] });
  const openrouter = new FakeOpenRouterClient(
    async (o: ChatOptions): Promise<ChatResult> => {
      const text = o.messages.map((m) => m.content).join('\n');
      const usage = { tokensIn: 50, tokensOut: 60, costUsd: 0.001 };
      if (text.includes('toolCatalog')) {
        return {
          content: JSON.stringify(plan),
          model: o.model,
          usage,
          durationMs: 5,
        };
      }
      if (text.includes('marketing copy variants')) {
        return {
          content: JSON.stringify({
            variants: [
              {
                channel: 'instagram',
                headline: 'Big launch',
                body: 'It is here.',
                cta: 'Shop now',
              },
            ],
          }),
          model: o.model,
          usage,
          durationMs: 5,
        };
      }
      return {
        content: 'Run summary: campaign created and copy written.',
        model: o.model,
        usage,
        durationMs: 5,
      };
    },
  );
  const budget = createFakeBudget(opts.affordable ?? true, opts.budgetReason);
  const conversation = createFakeConversation();
  const emitter = createFakeEmitter();
  const memory = createFakeMemory();
  const deps: OrchestratorDeps = {
    db,
    openrouter,
    router: new FakeModelRouter(),
    registry: createDefaultRegistry(),
    config: {
      ...DEFAULT_ORCHESTRATOR_CONFIG,
      stepTimeoutMs: 5000,
      runTimeoutMs: 15000,
    },
    ports: {
      makeEmit: emitter.makeEmit,
      makeBudget: () => budget,
      makeStorage: () => createFakeStorage(db),
      makeConversation: () => conversation,
      makeMemory: () => memory.store,
    },
    emitGlobal: emitter.emitGlobal,
  };
  return {
    db,
    budget,
    conversation,
    emitter,
    memoryProject: memory.project,
    orch: new Orchestrator(deps),
  };
}

describe('Orchestrator.executeRun (fake ports, fake Db)', () => {
  it('runs a 2-step plan to completion', async () => {
    const { db, conversation, emitter, memoryProject, orch } = setup(COPY_PLAN);
    const { id: runId } = await orch.startRun({
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      conversationId: 'c1',
      input: 'Launch a campaign',
      language: 'en',
    });

    await orch.executeRun(runId);

    const runs = db.__table('agent_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].completedSteps).toBe(2);
    expect(runs[0].totalSteps).toBe(2);

    const campaigns = db.__table('campaigns');
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].name).toBe('Launch');

    const docs = db.__table('design_documents');
    expect(docs).toHaveLength(1);
    expect((docs[0].canvas as { kind: string }).kind).toBe('marketing_copy');

    const types = emitter.events.filter((e) => !e.global).map((e) => e.type);
    for (const t of [
      'run.started',
      'run.state',
      'step.started',
      'step.completed',
      'tool.started',
      'tool.completed',
      'run.progress',
      'usage',
      'run.finished',
    ] as const) {
      expect(types).toContain(t);
    }

    // Honest summary delivered to the conversation.
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0].conversationId).toBe('c1');
    expect(conversation.messages[0].content).toContain('Run summary');

    // Project memory updated with the run summary.
    expect(memoryProject.get('p1')?.['last_run_summary']).toBeDefined();
  });

  it('startRun is idempotent on idempotencyKey (24h window)', async () => {
    const { db, orch } = setup(COPY_PLAN);
    const params = {
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      input: 'Launch',
      idempotencyKey: 'dup-key-1',
    };
    const first = await orch.startRun(params);
    const second = await orch.startRun(params);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(db.__table('agent_runs')).toHaveLength(1);
  });

  it('parks the run in waiting_approval when a generation is unaffordable, then resumes after approve', async () => {
    const plan = {
      steps: [
        {
          id: 's1',
          tool: 'generate_image',
          title: 'Generate hero image',
          args: { prompt: 'a hero' },
          dependsOn: [],
        },
      ],
      estimatedCostUsd: 0.04,
    };
    const { db, emitter, budget, orch } = setup(plan, {
      affordable: false,
      budgetReason: 'Out of credits',
    });
    const { id: runId } = await orch.startRun({
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      input: 'Make an image',
    });

    await orch.executeRun(runId);

    const runs = db.__table('agent_runs');
    expect(runs[0].status).toBe('waiting_approval');
    expect(
      (runs[0].approval as { reason: string }).reason,
    ).toContain('Out of credits');
    const types = emitter.events.filter((e) => !e.global).map((e) => e.type);
    expect(types).toContain('run.waiting_approval');

    // Approve with a raised budget, restore affordability, re-run to completion.
    const approved = await orch.approveRun(runId, true, 5);
    expect(approved.state).toBe('running');
    expect(db.__table('agent_runs')[0].budgetUsd).toBe('5');
    budget.setAffordable(true);
    await orch.executeRun(runId);
    expect(db.__table('agent_runs')[0].status).toBe('completed');
    expect(db.__table('assets')).toHaveLength(1);
  });

  it('cancelRun transitions a pending run to cancelled and executeRun becomes a no-op', async () => {
    const { db, orch } = setup(COPY_PLAN);
    const { id: runId } = await orch.startRun({
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      input: 'Launch',
    });
    const cancelled = await orch.cancelRun(runId);
    expect(cancelled.state).toBe('cancelled');
    await orch.executeRun(runId);
    expect(db.__table('agent_runs')[0].status).toBe('cancelled');
    expect(db.__table('campaigns')).toHaveLength(0);
  });

  it('a failed run can be resumed (attempts+1) and reports honestly', async () => {
    const badPlan = {
      steps: [
        {
          id: 's1',
          tool: 'create_campaign',
          title: 'Bad args',
          args: { name: '' }, // zod min(1) fails → ToolError
          dependsOn: [],
        },
      ],
      estimatedCostUsd: 0,
    };
    const { db, conversation, orch } = setup(badPlan);
    const { id: runId } = await orch.startRun({
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      conversationId: 'c1',
      input: 'Do it',
    });

    await orch.executeRun(runId);
    const runs = db.__table('agent_runs');
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error).toContain('Invalid arguments');
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0].content).toContain("couldn't complete");

    const resumed = await orch.resumeRun(runId);
    expect(resumed.state).toBe('pending');
    expect(db.__table('agent_runs')[0].attempts).toBe(1);
  });
});
