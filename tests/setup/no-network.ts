/**
 * Integration-test guard: no external HTTP, ever.
 *
 * Replaces global fetch with a stub that records every attempt and then
 * throws, so any code path that tried to reach a real provider (e.g. a
 * half-wired OpenRouter client) fails loudly instead of billing or hanging.
 *
 * Tests assert on `fetchCalls()` — the unavailable-provider fallback must complete with
 * zero recorded calls.
 */
export interface FetchAttempt {
  url: string;
  method: string;
}

const attempts: FetchAttempt[] = [];

(globalThis as unknown as { __fetchCalls: FetchAttempt[] }).__fetchCalls = attempts;

export function fetchCalls(): FetchAttempt[] {
  return attempts;
}

export function resetFetchCalls(): void {
  attempts.length = 0;
}

// Also reachable without importing this module (setup files run before tests):
(globalThis as unknown as { __resetFetchCalls: () => void }).__resetFetchCalls = resetFetchCalls;

globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
  const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
  attempts.push({ url, method: init?.method ?? 'GET' });
  throw new Error(`[test-guard] external HTTP blocked: ${url}`);
}) as typeof fetch;
