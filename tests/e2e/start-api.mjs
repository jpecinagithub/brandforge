import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Defaults are deliberately limited to the disposable E2E database and local
// filesystem. CI can override DATABASE_URL while keeping the same launcher.
process.env.DATABASE_URL ??= 'postgres://brandforge:brandforge_dev_pw@localhost:5432/brandforge_test';
process.env.PORT = '3014';
process.env.NODE_ENV = 'development';
process.env.CORS_ORIGIN = 'http://localhost:5173,http://localhost:4173';
process.env.MAIL_TRANSPORT = 'maildir';
process.env.MAIL_FROM = 'noreply@brandforge.local';
process.env.MAILDIR_PATH ??= join(tmpdir(), 'brandforge-e2e-maildir');
process.env.STORAGE_PATH ??= join(tmpdir(), 'brandforge-e2e-storage');

await import('../../apps/api/dist/index.js');
