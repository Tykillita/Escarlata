import { Provider, ProviderOptions, ProviderEvent, Message, type AuthMethod } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OpenAIProvider } from './openai.js';
import { ClaudeOAuthProvider } from './claude-oauth.js';
import { CodexOAuthProvider } from './codex-oauth.js';
import { ToolDefinition } from '../tools/registry.js';

export function createProvider(options: ProviderOptions): Provider {
  const providerType = options.provider?.toLowerCase() || process.env.MODEL_PROVIDER?.toLowerCase() || 'mock';
  const authMethod = (options.authMethod || process.env.MODEL_AUTH_METHOD || 'api_key') as AuthMethod;

  switch (providerType) {
    case 'anthropic': {
      if (authMethod === 'oauth_local') return new ClaudeOAuthProvider({ ...options, provider: providerType, authMethod });
      const key = options.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('API key required for Anthropic provider');
      return new AnthropicProvider({ ...options, apiKey: key });
    }
    case 'openai': {
      if (authMethod === 'oauth_local') return new CodexOAuthProvider({ ...options, provider: providerType, authMethod });
      const key = options.apiKey || process.env.OPENAI_API_KEY;
      if (!key) throw new Error('API key required for OpenAI provider');
      return new OpenAIProvider({ ...options, apiKey: key, provider: providerType, authMethod });
    }
    case 'ollama':
      return new OllamaProvider(options);
    case 'openrouter':
      return new OpenAICompatibleProvider({
        ...options,
        apiKey: options.apiKey || process.env.OPENROUTER_API_KEY || '',
        baseUrl: options.baseUrl || 'https://openrouter.ai/api/v1',
      });
    case 'nvidia':
      return new OpenAICompatibleProvider({
        ...options,
        apiKey: options.apiKey || process.env.NVIDIA_API_KEY || '',
        baseUrl: options.baseUrl || 'https://integrate.api.nvidia.com/v1',
      });
    default:
      return createMockProvider();
  }
}

function createMockProvider(): Provider {
  return {
    async *complete(
      messages: Message[],
      _tools?: ToolDefinition[]
    ): AsyncIterable<ProviderEvent> {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const userText = typeof lastUser?.content === 'string'
        ? lastUser.content
        : '[complex message]';

      const response = `Mock response to: "${userText}". This is a streaming response from the mock provider.`;
      for (const char of response) {
        yield { type: 'text', delta: char };
        await new Promise(r => setTimeout(r, 3));
      }
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}
