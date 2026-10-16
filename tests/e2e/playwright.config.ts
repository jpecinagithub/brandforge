import { defineConfig } from '@playwright/test';

/**
 * BrandForge E2E (Playwright, Chromium, headless).
 *
 * Spins up the REAL stack:
 *  - API  : committed launcher → Fastify on :3014, brandforge_test DB,
 *           maildir and storage in the operating system's temporary folder.
 *  - Web  : `vite preview` on :4173 serving apps/web/dist, which must be
 *           built with VITE_API_URL=http://localhost:3014 (see tests/README).
 *
 * The specs drive the UI like a user: demo entry, register → verify (token
 * read from the maildir) → login → campaign/brand-kit/asset flows.
 */
export default defineConfig({
  testDir: '.',
  timeout: 90000,
  retries: 0,
  workers: 1, // specs share one API + DB; keep them sequential
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node tests/e2e/start-api.mjs',
      cwd: '../..',
      port: 3014,
      reuseExistingServer: true,
      timeout: 60000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npx vite preview --port 4173 --strictPort',
      cwd: '../../apps/web',
      port: 4173,
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
});
