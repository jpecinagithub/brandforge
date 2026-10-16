import { defineConfig, defineProject } from 'vitest/config';

/**
 * BrandForge test setup (Phases 1-2).
 *
 * Two projects:
 *  - `unit`: fast, no I/O — pure helpers (argon2id, tokens, uuid guard, RBAC),
 *    Zod schema rejections and the OpenRouter client. Target <30s.
 *  - `integration`: Fastify `inject` against the `brandforge_test` Postgres DB
 *    (NEVER the dev `brandforge` DB). One file at a time (fileParallelism:
 *    false) because all files share the same DB and truncate it per test.
 *
 * Run from the repo root:
 *  npm run test:unit
 *  npm run test:integration
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://brandforge:brandforge_dev_pw@localhost:5432/brandforge_test';

export default defineConfig({
  test: {
    projects: [
      defineProject({
        test: {
          name: 'unit',
          include: [
            'apps/api/src/**/*.test.ts',
            'apps/web/src/**/*.test.ts',
            'apps/worker/src/**/*.test.ts',
            'packages/integrations/src/**/*.test.ts',
            'packages/agent-core/src/**/*.test.ts',
          ],
          exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
          testTimeout: 20000,
          env: {
            // Pure route-helper tests import the API config module but never
            // connect; provide a syntactically valid placeholder URL.
            DATABASE_URL: TEST_DATABASE_URL,
          },
        },
      }),
      defineProject({
        test: {
          name: 'integration',
          include: ['apps/api/src/**/*.integration.test.ts'],
          exclude: ['**/node_modules/**'],
          testTimeout: 60000,
          hookTimeout: 60000,
          fileParallelism: false,
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: TEST_DATABASE_URL,
            PORT: '3014',
            CORS_ORIGIN: 'http://localhost:4173',
            MAIL_TRANSPORT: 'maildir',
            MAIL_FROM: 'noreply@brandforge.local',
            MAILDIR_PATH: '/tmp/bf-test-maildir',
            STORAGE_PATH: '/tmp/bf-test-storage',
          },
          setupFiles: ['tests/setup/no-network.ts'],
        },
      }),
    ],
  },
});
