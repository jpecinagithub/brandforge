import { describe, expect, it } from 'vitest';
import { RUN_TRANSITIONS, type RunState } from '@brandforge/shared';
import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
} from './state-machine.js';

describe('canTransition', () => {
  it('allows every transition declared in RUN_TRANSITIONS', () => {
    for (const [from, tos] of Object.entries(RUN_TRANSITIONS) as [
      RunState,
      readonly RunState[],
    ][]) {
      for (const to of tos) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it('rejects transitions not in RUN_TRANSITIONS', () => {
    const illegal: [RunState, RunState][] = [
      ['pending', 'running'],
      ['pending', 'completed'],
      ['pending', 'waiting_approval'],
      ['planning', 'planning'],
      ['planning', 'pending'],
      ['planning', 'completed'],
      ['running', 'planning'],
      ['running', 'pending'],
      ['waiting_approval', 'planning'],
      ['waiting_approval', 'completed'],
      ['completed', 'pending'],
      ['completed', 'failed'],
      ['completed', 'cancelled'],
      ['failed', 'completed'],
      ['cancelled', 'failed'],
    ];
    for (const [from, to] of illegal) {
      expect(canTransition(from, to)).toBe(false);
    }
  });
});

describe('assertTransition', () => {
  it('does not throw for legal transitions', () => {
    expect(() => assertTransition('pending', 'planning')).not.toThrow();
    expect(() => assertTransition('planning', 'running')).not.toThrow();
    expect(() => assertTransition('running', 'waiting_approval')).not.toThrow();
    expect(() => assertTransition('waiting_approval', 'running')).not.toThrow();
    expect(() => assertTransition('failed', 'pending')).not.toThrow();
    expect(() => assertTransition('failed', 'running')).not.toThrow();
    expect(() => assertTransition('cancelled', 'running')).not.toThrow();
  });

  it('throws IllegalTransitionError for illegal transitions', () => {
    expect(() => assertTransition('completed', 'running')).toThrow(
      IllegalTransitionError,
    );
    expect(() => assertTransition('pending', 'completed')).toThrow(
      /pending -> completed/,
    );
    try {
      assertTransition('running', 'pending');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      const e = err as IllegalTransitionError;
      expect(e.from).toBe('running');
      expect(e.to).toBe('pending');
    }
  });
});
