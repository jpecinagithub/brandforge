import { describe, expect, it } from 'vitest';
import { recoveryTarget } from './recovery.js';

describe('recoveryTarget', () => {
  it('replans interrupted planning work and resumes stored execution plans', () => {
    expect(recoveryTarget('planning', 1, 3)).toBe('pending');
    expect(recoveryTarget('running', 1, 3)).toBe('running');
  });

  it('stops retrying at the configured attempt limit', () => {
    expect(recoveryTarget('planning', 3, 3)).toBe('failed');
    expect(recoveryTarget('running', 4, 3)).toBe('failed');
  });

  it('does not touch terminal or approval states', () => {
    expect(recoveryTarget('completed', 1, 3)).toBeNull();
    expect(recoveryTarget('failed', 1, 3)).toBeNull();
    expect(recoveryTarget('waiting_approval', 1, 3)).toBeNull();
  });
});
