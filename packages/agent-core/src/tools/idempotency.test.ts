import { describe, expect, it } from 'vitest';
import { stableHash } from './helpers.js';

describe('stableHash (tool-call idempotency)', () => {
  it('is stable regardless of key order', () => {
    const a = { prompt: 'a cat', aspectRatio: '1:1' };
    const b = { aspectRatio: '1:1', prompt: 'a cat' };
    expect(stableHash(a)).toBe(stableHash(b));
  });

  it('is stable for nested objects regardless of key order', () => {
    const a = { outer: { b: 1, a: [1, 2, { z: 'x', y: 'w' }] } };
    const b = { outer: { a: [1, 2, { y: 'w', z: 'x' }], b: 1 } };
    expect(stableHash(a)).toBe(stableHash(b));
  });

  it('differs for different args', () => {
    expect(stableHash({ prompt: 'a' })).not.toBe(stableHash({ prompt: 'b' }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 1, b: 2 }));
  });

  it('ignores undefined values (like JSON serialization)', () => {
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
  });

  it('produces a 64-char hex digest', () => {
    expect(stableHash({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
