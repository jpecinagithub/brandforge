/**
 * @brandforge/integrations — PHASE 3 STUB.
 *
 * External provider clients live here. In Phase 3 the OpenRouter client is
 * implemented here and used ONLY server-side (Oracle). API keys must never
 * reach the browser — see README.
 */

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet (Phase 3)`);
    this.name = 'NotImplementedError';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * OpenRouter chat client (server-side only). Every method throws
 * NotImplementedError until Phase 3 wires the real HTTP client.
 */
export interface OpenRouterClient {
  chat(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
}

export class StubOpenRouterClient implements OpenRouterClient {
  async chat(_options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    throw new NotImplementedError('OpenRouterClient.chat');
  }
}

export function createOpenRouterClient(): OpenRouterClient {
  return new StubOpenRouterClient();
}
