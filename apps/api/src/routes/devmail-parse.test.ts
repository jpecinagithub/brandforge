import { describe, expect, it } from 'vitest';
import { parseEml } from './devmail-parse.js';

const SIMPLE = [
  'From: BrandForge <noreply@brandforge.test>',
  'To: jon@example.com',
  'Subject: Verify your BrandForge account',
  'Date: Wed, 14 Oct 2026 15:00:00 +0200',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="--_NmP-test123"',
  '',
  '----_NmP-test123',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hi Jon,=0A=0AVerify here: https://x.test/verify?token=3Dabc',
  '----_NmP-test123',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<p>Hi Jon,</p><p><a href=3D"https://x.test/verify?token=3Dabc">Verify</a></p>',
  '----_NmP-test123--',
  '',
].join('\r\n');

describe('parseEml', () => {
  it('parses headers and both bodies, decoding quoted-printable', () => {
    const p = parseEml(SIMPLE);
    expect(p.from).toContain('noreply@brandforge.test');
    expect(p.to).toBe('jon@example.com');
    expect(p.subject).toBe('Verify your BrandForge account');
    expect(p.text).toContain('https://x.test/verify?token=abc');
    expect(p.html).toContain('href="https://x.test/verify?token=abc"');
  });

  it('unfolds long headers and decodes RFC2047 subjects', () => {
    const raw = [
      'Subject: =?UTF-8?Q?Welcome_to_BrandForge_=F0=9F=8E=89?=\r\n',
      'To: a@b.c\r\n',
      'Content-Type: text/plain; charset=utf-8\r\n',
      '\r\n',
      'hello\r\n',
    ].join('');
    const p = parseEml(raw);
    expect(p.subject).toContain('🎉');
    expect(p.text).toBe('hello');
  });

  it('handles plain single-part messages', () => {
    const p = parseEml('Subject: hi\r\nTo: a@b.c\r\n\r\nplain body\r\n');
    expect(p.subject).toBe('hi');
    expect(p.text).toBe('plain body');
    expect(p.html).toBe('');
  });
});
