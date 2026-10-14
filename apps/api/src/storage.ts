/**
 * Storage module — local-disk adapter with an interface ready for a future
 * S3-compatible backend (implement `StorageAdapter` against an S3 client and
 * swap the factory in `getStorage()`).
 *
 * Layout under STORAGE_PATH:
 *   avatars/<uuid>.<ext>   — user avatars (≤2MB, images only)
 *   assets/<uuid>.<ext>     — project assets (≤10MB, images only)
 *
 * Filenames are internal-safe: `<uuid>` + a whitelisted extension derived
 * from the original name (or the detected mime). Original names are stored
 * in the DB row, never on disk.
 */
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;
export type AllowedImageExt = (typeof ALLOWED_IMAGE_EXTS)[number];

export function extOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isAllowedImageExt(ext: string): ext is AllowedImageExt {
  return (ALLOWED_IMAGE_EXTS as readonly string[]).includes(ext);
}

export interface StorageAdapter {
  /** Write bytes; returns the relative path (e.g. `assets/<uuid>.png`). */
  put(relativePath: string, data: Buffer): Promise<string>;
  /** Read bytes by relative path. */
  get(relativePath: string): Promise<Buffer>;
  /** Best-effort delete; never throws when the file is missing. */
  remove(relativePath: string): Promise<void>;
  /** Absolute path for a relative path (local adapter only — for downloads). */
  absolutePath(relativePath: string): string;
}

function guard(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid storage path');
  }
  return normalized;
}

export class LocalDiskStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  async put(relativePath: string, data: Buffer): Promise<string> {
    const rel = guard(relativePath);
    const full = path.join(this.root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return rel;
  }

  async get(relativePath: string): Promise<Buffer> {
    return readFile(path.join(this.root, guard(relativePath)));
  }

  async remove(relativePath: string): Promise<void> {
    try {
      await rm(path.join(this.root, guard(relativePath)), { force: true });
    } catch {
      // best-effort
    }
  }

  absolutePath(relativePath: string): string {
    return path.join(this.root, guard(relativePath));
  }
}

let storage: StorageAdapter | null = null;

/** Process-wide storage singleton (local disk in Phases 1-2). */
export function getStorage(): StorageAdapter {
  if (!storage) storage = new LocalDiskStorage(config.storagePath);
  return storage;
}

/** Build an internal-safe relative path for an uploaded file. */
export function buildObjectPath(kind: 'avatars' | 'assets', id: string, originalName: string): string {
  const ext = extOf(originalName);
  const safeExt = isAllowedImageExt(ext) ? ext : '.bin';
  return `${kind}/${id}${safeExt}`;
}

/**
 * Resolve both current and legacy asset layouts.
 *
 * Uploaded files historically stored only the basename in Postgres and lived
 * under `assets/`. Agent-generated files lived under `<workspaceId>/` but also
 * stored only the basename. New rows persist their complete relative path.
 */
export function assetStorageCandidates(filename: string, workspaceId: string): string[] {
  if (filename.includes('/')) return [filename];
  return [`assets/${filename}`, `${workspaceId}/${filename}`];
}

/**
 * Detect an image's real type from magic bytes. Returns the extension and
 * canonical mime, or null when the bytes are not a supported image.
 */
export function detectImage(buf: Buffer): { ext: AllowedImageExt; mime: string } | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: '.png', mime: 'image/png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return { ext: '.gif', mime: 'image/gif' };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', mime: 'image/webp' };
  }
  return null;
}
