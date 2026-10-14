import { describe, expect, it } from 'vitest';
import { generateImageTool } from './generate-image.js';
import {
  createFakeBudget,
  createFakeConversation,
  createFakeDb,
  createFakeEmitter,
  createFakeMemory,
  createFakeStorage,
  FakeModelRouter,
  FakeOpenRouterClient,
} from '../__tests__/fakes.js';
import { BUDGET_NOT_AFFORDABLE } from './helpers.js';
import type { Db } from '@brandforge/database';
import type { FakeDb } from '../__tests__/fakes.js';
import type {
  BudgetPort,
  OpenRouterClient,
  StoragePort,
  ToolContext,
} from '../types.js';

const PROJECT_ROW = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'Project',
  description: '',
  isFavorite: false,
  createdAt: new Date(),
  updatedAt: null,
};

function makeCtx(
  db: Db & FakeDb,
  budget: BudgetPort,
  openrouter: OpenRouterClient,
  storage: StoragePort,
): ToolContext {
  const emitter = createFakeEmitter();
  return {
    db,
    userId: 'u1',
    workspaceId: 'w1',
    projectId: 'p1',
    runId: 'r1',
    stepId: 's1',
    language: 'en',
    openrouter,
    router: new FakeModelRouter(),
    emit: emitter.makeEmit('r1'),
    budget,
    storage,
    conversation: createFakeConversation(),
    memory: createFakeMemory().store,
  };
}

describe('generate_image budget guard', () => {
  it('aborts BEFORE any model call when checkAffordable is false', async () => {
    const db = createFakeDb({ projects: [PROJECT_ROW] });
    const openrouter = new FakeOpenRouterClient();
    const storage = createFakeStorage(db);
    const budget = createFakeBudget(false, 'No credits left');
    const ctx = makeCtx(db, budget, openrouter, storage);

    const result = await generateImageTool.execute(ctx, { prompt: 'a cat' });

    expect(result.ok).toBe(false);
    expect((result.data as { code: string }).code).toBe(BUDGET_NOT_AFFORDABLE);
    expect(result.summary).toContain('No credits left');
    // Nothing was spent: no model call, no file stored.
    expect(openrouter.imageCalls).toHaveLength(0);
    expect(storage.files).toHaveLength(0);
    expect(db.__table('assets')).toHaveLength(0);
  });

  it('generates, stores and links the asset when affordable', async () => {
    const db = createFakeDb({ projects: [PROJECT_ROW] });
    const openrouter = new FakeOpenRouterClient();
    const storage = createFakeStorage(db);
    const budget = createFakeBudget(true);
    const ctx = makeCtx(db, budget, openrouter, storage);

    const result = await generateImageTool.execute(ctx, {
      prompt: 'a cat',
      aspectRatio: '1:1',
      name: 'cat.png',
    });

    expect(result.ok).toBe(true);
    expect(openrouter.imageCalls).toHaveLength(1);
    expect(storage.files).toHaveLength(1);
    const data = result.data as { assetId: string; url: string; model: string };
    expect(data.model).toBe('fake-image-model');
    expect(data.url).toContain(data.assetId);
    expect(result.usage?.costUsd).toBe(0.04);
    // The asset row created by the storage port is linked to the project.
    const assets = db.__table('assets');
    expect(assets).toHaveLength(1);
    expect(assets[0].projectId).toBe('p1');
  });

  it('rejects projects outside the workspace (authorization)', async () => {
    const db = createFakeDb({
      projects: [{ ...PROJECT_ROW, id: 'p-other', workspaceId: 'w-other' }],
    });
    const ctx = makeCtx(
      db,
      createFakeBudget(true),
      new FakeOpenRouterClient(),
      createFakeStorage(db),
    );
    await expect(generateImageTool.execute(ctx, { prompt: 'x' })).rejects.toThrow(
      /workspace/i,
    );
  });
});
