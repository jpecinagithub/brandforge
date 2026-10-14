/** Unit: RBAC role ordering used by requireWorkspaceRole / projectGuard. */
import { describe, expect, it } from 'vitest';
import type { WorkspaceRole } from '@brandforge/shared';
import { roleAtLeast } from './authz.js';

describe('roleAtLeast', () => {
  const roles: WorkspaceRole[] = ['viewer', 'editor', 'owner'];

  it('returns false for a null (non-member) role', () => {
    for (const min of roles) expect(roleAtLeast(null, min)).toBe(false);
  });

  it('a role satisfies itself and every lower minimum', () => {
    expect(roleAtLeast('viewer', 'viewer')).toBe(true);
    expect(roleAtLeast('editor', 'viewer')).toBe(true);
    expect(roleAtLeast('editor', 'editor')).toBe(true);
    expect(roleAtLeast('owner', 'viewer')).toBe(true);
    expect(roleAtLeast('owner', 'editor')).toBe(true);
    expect(roleAtLeast('owner', 'owner')).toBe(true);
  });

  it('a role does not satisfy a higher minimum', () => {
    expect(roleAtLeast('viewer', 'editor')).toBe(false);
    expect(roleAtLeast('viewer', 'owner')).toBe(false);
    expect(roleAtLeast('editor', 'owner')).toBe(false);
  });

  it('encodes the full ordering viewer < editor < owner', () => {
    const rank: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };
    for (const role of roles) {
      for (const min of roles) {
        expect(roleAtLeast(role, min)).toBe(rank[role] >= rank[min]);
      }
    }
  });
});
