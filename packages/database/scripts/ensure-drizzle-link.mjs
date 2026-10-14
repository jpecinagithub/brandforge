/**
 * Ensures `drizzle-kit` (hoisted to the repo root by npm) can resolve
 * `drizzle-orm/version` for its compatibility check.
 *
 * npm nests drizzle-orm inside each workspace (its optional expo/react-native
 * peers conflict with apps/web's tree, so it can never be hoisted). The
 * drizzle-kit CLI resolves imports relative to its own file, i.e. from the
 * repo root — where drizzle-orm does not exist — and aborts with
 * "Please install latest version of drizzle-orm".
 *
 * This script creates a self-healing symlink:
 *   <repo>/node_modules/drizzle-orm -> packages/database/node_modules/drizzle-orm
 * It runs before every db:generate / db:migrate, so a future `npm install`
 * that prunes the link is repaired automatically on next use.
 */
import { existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..', '..', '..');
const link = path.join(repoRoot, 'node_modules', 'drizzle-orm');
const target = path.join(scriptsDir, '..', 'node_modules', 'drizzle-orm');

if (!existsSync(target)) {
  console.error(`[db] nested drizzle-orm not found at ${target} — run npm install first`);
  process.exit(1);
}
if (!existsSync(link)) {
  // Directory symlinks require Developer Mode or elevated privileges on
  // Windows; a junction provides the same module-resolution behaviour.
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  console.log('[db] linked <repo>/node_modules/drizzle-orm for drizzle-kit');
}
