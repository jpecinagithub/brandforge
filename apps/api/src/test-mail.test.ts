/**
 * Unit: quoted-printable email token extraction.
 *
 * Regression test for a real bug: nodemailer QP-encodes the `=` in
 * `?token=` as `=3D` and folds long lines with soft breaks, so a naive
 * `token=([A-Za-z0-9_-]+)` regex glues the `3D` onto the token and email
 * verification fails with INVALID_TOKEN.
 */
import { describe, expect, it } from 'vitest';
import { extractTokenFromEml, qpDecode } from './test-mail.js';

// 43-char base64url token, as emitted by randomToken()
const TOKEN = 'apmS_8y5CHPWPlcU8dWJgOgM03-bvWJRyXbyHzK4-ww';
const FIRST_HALF = TOKEN.slice(0, 34);
const SECOND_HALF = TOKEN.slice(34);

/** Mimics the real captured .eml: =3D-escaped `token=` + soft break mid-token. */
const FAKE_EML = [
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Verify your email within 24 hours:',
  `http://localhost:5173/verify-email?token=3D${FIRST_HALF}=`,
  `${SECOND_HALF}`,
  '',
  `<a href=3D"http://localhost:5173/verify-email?token=3D${TOKEN}">Verify</a>`,
].join('\r\n');

describe('qpDecode', () => {
  it('joins soft-broken lines and decodes =XX escapes', () => {
    const decoded = qpDecode('foo=\r\nbar=3Dbaz');
    expect(decoded).toBe('foobar=baz');
  });
});

describe('extractTokenFromEml', () => {
  it('recovers the exact 43-char token from a QP-folded email', () => {
    expect(extractTokenFromEml(FAKE_EML)).toBe(TOKEN);
  });

  it('does not glue the =3D escape onto the token', () => {
    const token = extractTokenFromEml(FAKE_EML);
    expect(token).toHaveLength(43);
    expect(token.startsWith('3D')).toBe(false);
  });

  it('throws when no token link is present', () => {
    expect(() => extractTokenFromEml('nothing here')).toThrow(/no token=/);
  });
});
