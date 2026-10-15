/**
 * TEST DOUBLE — never billed and never calls an external provider.
 *
 * A fake OpenRouterClient for tests that need an "AI" collaborator without
 * touching the network. It returns a canned echo reply; it never performs
 * HTTP, never reads credentials, and can never incur provider billing.
 *
 * Usage: `const client = new MockOpenRouterClient({ reply: '...' })`.
 */
import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  OpenRouterClient,
} from '@brandforge/integrations';

export class MockOpenRouterClient implements OpenRouterClient {
  /** Every chat() call made, in order — assert on this, not on the network. */
  readonly calls: ChatCompletionOptions[] = [];

  constructor(private readonly cannedReply = '[mock] AI reply (test double — not a real model)') {}

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    this.calls.push(options);
    const lastUser = [...options.messages].reverse().find((m) => m.role === 'user');
    return {
      content: `${this.cannedReply} — you said: ${lastUser?.content ?? '(nothing)'}`,
      model: 'mock/test-double',
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}
