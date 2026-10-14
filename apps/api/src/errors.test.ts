/** Unit: isUuid guard used by the global preHandler on UUID route params. */
import { describe, expect, it } from 'vitest';
import { isUuid } from './errors.js';

describe('isUuid', () => {
  it.each([
    'a8098c1a-f86e-11da-bd1a-00112444be1e',
    'A8098C1A-F86E-11DA-BD1A-00112444BE1E', // canonical form is case-insensitive
    '00000000-0000-0000-0000-000000000000',
    '123e4567-e89b-12d3-a456-426614174000',
  ])('accepts canonical UUID %s', (v) => {
    expect(isUuid(v)).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    'a8098c1a-f86e-11da-bd1a-00112444be1', // one char short
    'a8098c1a_f86e_11da_bd1a_00112444be1e', // wrong separators
    '{a8098c1a-f86e-11da-bd1a-00112444be1e}', // braces
    'a8098c1a-f86e-11da-bd1a-00112444be1e ', // trailing space
    'a8098c1a-f86e-11da-bd1a-00112444be1eg', // non-hex char
    null,
    undefined,
    42,
    {},
  ])('rejects %j', (v) => {
    expect(isUuid(v)).toBe(false);
  });
});
