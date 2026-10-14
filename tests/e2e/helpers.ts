/**
 * Shared E2E helpers.
 *
 * The maildir token extraction mirrors apps/api/src/test-mail.ts (same
 * quoted-printable algorithm): the API writes verification/reset emails as
 * .eml files, and the specs pull the token out of the newest one instead of
 * going through a real inbox.
 */
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const MAILDIR = '/tmp/bf-test-maildir';

export async function clearMaildir(): Promise<void> {
  let files: string[] = [];
  try {
    files = await readdir(MAILDIR);
  } catch {
    return;
  }
  await Promise.all(files.filter((f) => f.endsWith('.eml')).map((f) => rm(path.join(MAILDIR, f), { force: true })));
}

/** Extract the 43-char token from the newest captured email (QP-decoded). */
export async function latestEmailToken(): Promise<string> {
  const files = (await readdir(MAILDIR)).filter((f) => f.endsWith('.eml')).sort();
  if (files.length === 0) throw new Error('maildir is empty — expected a captured email');
  const eml = await readFile(path.join(MAILDIR, files[files.length - 1]), 'utf8');
  const decoded = eml
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const m = decoded.match(/token=([A-Za-z0-9_-]{43})/);
  if (!m) throw new Error('no token= link in captured email');
  return m[1];
}

let seq = 0;
export function uniqueEmail(prefix: string): string {
  seq += 1;
  return `e2e-${prefix}-${Date.now()}-${seq}@test.brandforge.local`;
}

export const E2E_PASSWORD = 'Str0ngPassw0rd';
