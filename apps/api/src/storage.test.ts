import { describe, expect, it } from 'vitest';
import { assetStorageCandidates } from './storage.js';

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
});
