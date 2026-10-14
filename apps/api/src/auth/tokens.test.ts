/** Unit: token helpers — randomness, sha256 storage form, expiry math. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { daysFromNow, hoursFromNow, randomToken, sha256Hex } from './tokens.js';

describe('randomToken', () => {
  it('produces base64url tokens of the expected length', () => {
    const t = randomToken();
    expect(t).toHaveLength(43); // 32 bytes → base64url, no padding
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces unique tokens', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(seen.size).toBe(200);
  });

  it('honours the byte-length argument', () => {
    expect(randomToken(16)).toHaveLength(22);
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node:crypto for arbitrary input', () => {
    const token = randomToken();
    expect(sha256Hex(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
  });

  it('is deterministic and input-sensitive', () => {
    expect(sha256Hex('x')).toBe(sha256Hex('x'));
    expect(sha256Hex('x')).not.toBe(sha256Hex('y'));
  });
});

describe('hoursFromNow / daysFromNow', () => {
  it('adds the requested offset within tolerance', () => {
    const before = Date.now();
    const h = hoursFromNow(1).getTime();
    const d = daysFromNow(30).getTime();
    expect(h - before).toBeGreaterThanOrEqual(3600_000 - 1000);
    expect(h - before).toBeLessThanOrEqual(3600_000 + 1000);
    expect(d - before).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    expect(d - before).toBeLessThanOrEqual(30 * 86_400_000 + 1000);
  });
});
