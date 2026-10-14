/** Environment configuration. All secrets come from env — never hardcoded. */
import 'dotenv/config';
import { readAgentConfig, readQuotaPlanDefaults } from '@brandforge/agent-server';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer env var: ${name}`);
  return n;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int('PORT', 3013),
  databaseUrl: required('DATABASE_URL'),
  frontendUrl: (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  cookieSecure: (process.env.NODE_ENV ?? 'development') === 'production',
  // Cross-origin SPA (Vercel) + API needs SameSite=None in production.
  cookieSameSite: (process.env.COOKIE_SAMESITE ??
    ((process.env.NODE_ENV ?? 'development') === 'production' ? 'none' : 'lax')) as 'lax' | 'none' | 'strict',
  sessionTtlDays: int('SESSION_TTL_DAYS', 30),
  storagePath: process.env.STORAGE_PATH ?? './storage',
  mailTransport: (process.env.MAIL_TRANSPORT ?? 'maildir') as 'maildir' | 'smtp',
  mailFrom: process.env.MAIL_FROM ?? 'BrandForge <noreply@brandforge.local>',
  maildirPath: process.env.MAILDIR_PATH ?? './maildir',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int('SMTP_PORT', 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
  // Phase 3 agent engine tunables (all limits env-config per ADR-0006).
  agent: readAgentConfig(),
  quotaPlans: readQuotaPlanDefaults(),
  // OpenRouter is server-side only. The integrations package owns the typed
  // reader (readOpenRouterEnv); this mirror exists so config stays the single
  // place routes read env from. Never expose apiKey to the browser.
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    textModel: process.env.OPENROUTER_TEXT_MODEL || undefined,
    visionModel: process.env.OPENROUTER_VISION_MODEL || undefined,
    imageModel: process.env.OPENROUTER_IMAGE_MODEL || undefined,
    reviewModel: process.env.OPENROUTER_REVIEW_MODEL || undefined,
  },
};
