/**
 * Unit: the Phase-3 OpenRouter stub.
 *
 * Phase 3 (AI orchestrator) is NOT implemented. This test pins the honest
 * behaviour: every client method throws NotImplementedError instead of
 * attempting a network call — so no test (and no Phase 1-2 code path) can
 * ever reach the real OpenRouter API or incur billing.
 */
import { describe, expect, it } from 'vitest';
import {
  NotImplementedError,
  StubOpenRouterClient,
  createOpenRouterClient,
} from './index.js';

describe('OpenRouter stub (Phase 3 not implemented)', () => {
  it('createOpenRouterClient().chat rejects with NotImplementedError', async () => {
    const client = createOpenRouterClient();
    await expect(client.chat({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      NotImplementedError,
    );
  });

  it('StubOpenRouterClient.chat rejects with NotImplementedError', async () => {
    const client = new StubOpenRouterClient();
    const err = await client.chat({ model: 'x/y', messages: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotImplementedError);
    expect((err as Error).message).toMatch(/Phase 3/);
  });
});
