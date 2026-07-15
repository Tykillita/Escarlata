export type MessageRole = 'system' | 'user' | 'assistant';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
}

export function flattenContent(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map(b => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `[Using tool: ${b.name}]`;
      if (b.type === 'tool_result') return `[Tool result: ${b.content.slice(0, 100)}...]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// Provider events — what the provider yields during streaming
export interface TextEvent {
  type: 'text';
  delta: string;
}

export interface ToolUseEvent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface DoneEvent {
  type: 'done';
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export type ProviderEvent = TextEvent | ToolUseEvent | DoneEvent;

export interface Provider {
  complete(
    messages: Message[],
    tools?: import('../tools/registry.js').ToolDefinition[]
  ): AsyncIterable<ProviderEvent>;
}

export interface ProviderOptions {
  apiKey?: string;
  model: string;
  baseUrl?: string;
  provider?: string;
  authMethod?: AuthMethod;
}

export type AuthMethod = 'api_key' | 'oauth_local';
