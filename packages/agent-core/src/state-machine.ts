/**
 * Run state machine gate. `canTransition` is re-exported from
 * @brandforge/shared (single source of truth); `assertTransition` is the
 * throwing guard every orchestrator transition must go through.
 */
import { canTransition, type RunState } from '@brandforge/shared';

export { canTransition };

export class IllegalTransitionError extends Error {
  readonly from: RunState;
  readonly to: RunState;

  constructor(from: RunState, to: RunState) {
    super(`Illegal agent-run transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Throws IllegalTransitionError when the transition is not allowed. */
export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}
