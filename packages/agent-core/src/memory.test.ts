import { describe, expect, it } from 'vitest';
import { DbMemoryStore } from './memory.js';
import { createFakeDb } from './__tests__/fakes.js';

describe('DbMemoryStore', () => {
  it('upserts project memory by (scope, ownerId, key)', async () => {
    const db = createFakeDb();
    const store = new DbMemoryStore(db);

    expect(await store.getProjectMemory('p1')).toEqual({});

    await store.setProjectMemory('p1', 'tone', 'playful', 'Brand tone');
    await store.setProjectMemory('p1', 'audience', 'developers');
    expect(await store.getProjectMemory('p1')).toEqual({
      tone: 'playful',
      audience: 'developers',
    });

    // Upsert replaces the value for the same key.
    await store.setProjectMemory('p1', 'tone', 'formal');
    const mem = await store.getProjectMemory('p1');
    expect(mem['tone']).toBe('formal');
    expect(db.__table('agent_memories')).toHaveLength(2);
  });

  it('keeps user and project scopes separate', async () => {
    const db = createFakeDb();
    const store = new DbMemoryStore(db);
    await store.setUserMemory('u1', 'language', 'es');
    await store.setProjectMemory('u1', 'language', 'en');
    expect(await store.getUserMemory('u1')).toEqual({ language: 'es' });
    expect(await store.getProjectMemory('u1')).toEqual({ language: 'en' });
  });
});
