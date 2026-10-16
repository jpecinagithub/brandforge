import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetStorageCandidates, LocalDiskStorage } from './storage.js';

describe('assetStorageCandidates', () => {
  it('uses a persisted relative path directly', () => {
    expect(assetStorageCandidates('workspace-id/generated.png', 'workspace-id')).toEqual([
      'workspace-id/generated.png',
    ]);
  });

  it('supports both legacy upload and generated-asset layouts', () => {
    expect(assetStorageCandidates('legacy.png', 'workspace-id')).toEqual([
      'assets/legacy.png',
      'workspace-id/legacy.png',
    ]);
  });

  it('reports physical object availability without loading the file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'brandforge-storage-'));
    try {
      const storage = new LocalDiskStorage(root);
      expect(await storage.exists('assets/missing.png')).toBe(false);
      await storage.put('assets/present.png', Buffer.from('verified'));
      expect(await storage.exists('assets/present.png')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
