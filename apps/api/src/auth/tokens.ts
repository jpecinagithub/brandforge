/**
 * Token helpers. Pure/testable.
 * - Public tokens: 32 random bytes, base64url — carried in cookies / email links.
 * - Stored form: sha256 hex — so a DB leak does not yield usable tokens.
 */
import { createHash, randomBytes } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}
