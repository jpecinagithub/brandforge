/**
 * Maildir test helpers (integration tests). DB-free on purpose so the
 * extraction logic can be unit-tested.
 *
 * Captured .eml files are quoted-printable: long lines are folded with soft
 * breaks (`=\r\n`) and literal `=` bytes (including the `=` in `?token=`
 * itself!) are escaped as `=3D`. Extraction must QP-decode first, otherwise
 * the `3D` gets glued onto the token and verification fails with
 * INVALID_TOKEN (this exact bug was caught while writing the suite).
 */
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

function maildirPath(): string {
  return process.env.MAILDIR_PATH ?? '/tmp/bf-test-maildir';
}

/** Delete all captured .eml files (call in beforeEach for determinism). */
export async function clearMaildir(): Promise<void> {
  const dir = maildirPath();
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(files.filter((f) => f.endsWith('.eml')).map((f) => rm(path.join(dir, f), { force: true })));
}

/** Read the most recently written captured email. */
export async function newestEml(): Promise<string> {
  const dir = maildirPath();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.eml')).sort();
  if (files.length === 0) throw new Error('maildir is empty — expected a captured email');
  return readFile(path.join(dir, files[files.length - 1]), 'utf8');
}

/** Count captured emails (useful for "neutral" endpoints that must not send). */
export async function emlCount(): Promise<number> {
  try {
    return (await readdir(maildirPath())).filter((f) => f.endsWith('.eml')).length;
  } catch {
    return 0;
  }
}

/** Minimal quoted-printable decode: strip soft breaks, then =XX escapes. */
export function qpDecode(eml: string): string {
  return eml
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Pull the `token=<redacted> from a captured verification/reset email.
 * randomToken() emits 43 base64url chars for 32 bytes.
 */
export function extractTokenFromEml(eml: string): string {
  const decoded = qpDecode(eml);
  const m = decoded.match(/token=([A-Za-z0-9_-]{43})/);
  if (!m) throw new Error('no token= link found in captured email');
  return m[1];
}
