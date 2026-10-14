/**
 * Unit: zod input-schema rejections (the contracts the API validates before
 * touching the DB). Mirrors the frontend password policy: ≥10 chars, upper,
 * lower, digit.
 */
import { describe, expect, it } from 'vitest';
import {
  CreateProjectInputSchema,
  ForgotPasswordInputSchema,
  LoginInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema,
  SendMessageInputSchema,
} from '@brandforge/shared';

const GOOD_PASSWORD = 'Str0ngPassw0rd';

describe('RegisterInputSchema', () => {
  it('accepts a valid registration payload', () => {
    const r = RegisterInputSchema.safeParse({ name: 'Ada Lovelace', email: 'ada@example.com', password: GOOD_PASSWORD });
    expect(r.success).toBe(true);
  });

  it.each([
    ['too short', 'Sh0rtAa'],
    ['no uppercase', 'alllowercase1'],
    ['no lowercase', 'ALLUPPERCASE1'],
    ['no digit', 'NoDigitsHere!'],
    ['empty', ''],
  ])('rejects weak password (%s)', (_label, password) => {
    const r = RegisterInputSchema.safeParse({ name: 'Ada', email: 'ada@example.com', password });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const r = RegisterInputSchema.safeParse({ name: 'Ada', email: 'not-an-email', password: GOOD_PASSWORD });
    expect(r.success).toBe(false);
  });

  it('rejects a blank name', () => {
    const r = RegisterInputSchema.safeParse({ name: '   ', email: 'ada@example.com', password: GOOD_PASSWORD });
    expect(r.success).toBe(false);
  });
});

describe('LoginInputSchema', () => {
  it('requires a non-empty password', () => {
    expect(LoginInputSchema.safeParse({ email: 'ada@example.com', password: '' }).success).toBe(false);
    expect(LoginInputSchema.safeParse({ email: 'ada@example.com', password: 'x' }).success).toBe(true);
  });
});

describe('ForgotPasswordInputSchema / ResetPasswordInputSchema', () => {
  it('forgot-password rejects a malformed email', () => {
    expect(ForgotPasswordInputSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('reset-password enforces the strong password policy too', () => {
    const token = 'a'.repeat(43);
    expect(ResetPasswordInputSchema.safeParse({ token, password: 'weak' }).success).toBe(false);
    expect(ResetPasswordInputSchema.safeParse({ token: '', password: GOOD_PASSWORD }).success).toBe(false);
    expect(ResetPasswordInputSchema.safeParse({ token, password: GOOD_PASSWORD }).success).toBe(true);
  });
});

describe('SendMessageInputSchema', () => {
  it('rejects blank or oversized chat content', () => {
    expect(SendMessageInputSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(SendMessageInputSchema.safeParse({ content: 'x'.repeat(10001) }).success).toBe(false);
    expect(SendMessageInputSchema.safeParse({ content: 'Design a launch campaign' }).success).toBe(true);
  });
});

describe('CreateProjectInputSchema', () => {
  const ws = '123e4567-e89b-12d3-a456-426614174000';

  it('accepts a valid payload and defaults the description', () => {
    const r = CreateProjectInputSchema.safeParse({ workspaceId: ws, name: 'Launch' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBe('');
  });

  it('rejects a non-UUID workspaceId and a blank name', () => {
    expect(CreateProjectInputSchema.safeParse({ workspaceId: 'nope', name: 'Launch' }).success).toBe(false);
    expect(CreateProjectInputSchema.safeParse({ workspaceId: ws, name: '  ' }).success).toBe(false);
  });
});
