/** Unit: argon2id password hashing roundtrip. No DB, no network. */
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('hashPassword / verifyPassword (argon2id)', () => {
  it('verifies the correct password after hashing', async () => {
    const hash = await hashPassword('Str0ngPassw0rd');
    expect(await verifyPassword(hash, 'Str0ngPassw0rd')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Str0ngPassw0rd');
    expect(await verifyPassword(hash, 'Wr0ngPassw0rd')).toBe(false);
  });

  it('returns false (never throws) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'Str0ngPassw0rd')).toBe(false);
    expect(await verifyPassword('', 'Str0ngPassw0rd')).toBe(false);
  });

  it('salts: two hashes of the same password differ', async () => {
    const a = await hashPassword('Str0ngPassw0rd');
    const b = await hashPassword('Str0ngPassw0rd');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'Str0ngPassw0rd')).toBe(true);
    expect(await verifyPassword(b, 'Str0ngPassw0rd')).toBe(true);
  });

  it('uses the argon2id variant', async () => {
    const hash = await hashPassword('Str0ngPassw0rd');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });
});
