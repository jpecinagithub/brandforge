export type RecoveryTarget = 'pending' | 'running' | 'failed' | null;

/** Decide how an interrupted run is made claimable again. */
export function recoveryTarget(status: string, attempts: number, maxAttempts: number): RecoveryTarget {
  if (status !== 'planning' && status !== 'running') return null;
  if (attempts >= maxAttempts) return 'failed';
  return status === 'planning' ? 'pending' : 'running';
}
