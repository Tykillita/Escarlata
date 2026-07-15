import Anthropic from '@anthropic-ai/sdk';
import { Provider, ProviderOptions, Message, ProviderEvent, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock } from './types.js';
import { ToolDefinition } from '../tools/registry.js';

export class AnthropicProvider implements Provider {
  private client: Anthropic;
  private model: string;
  private pendingToolResult: { id: string; name: string; input: Record<string, unknown> } | null = null;

  constructor(options: ProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey || '' });
    this.model = options.model;
  }

  async *complete(
    messages: Message[],
    tools?: ToolDefinition[]
  ): AsyncIterable<ProviderEvent> {
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Convert our Message format to Anthropic's format
    const apiMessages: Anthropic.MessageParam[] = conversationMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string'
        ? m.content
        : m.content.map(b => this.blockToAnthropic(b)),
    }));

    // Build tool definitions for Anthropic API
    const apiTools: Anthropic.Tool[] | undefined = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          t.parameters.map(p => [
            p.name,
            { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) },
          ])
        ),
        required: t.parameters.filter(p => p.required).map(p => p.name),
      },
    }));

    const stream = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemMessage?.content as string || '',
      messages: apiMessages,
      tools: apiTools?.length ? apiTools : undefined,
      stream: true,
    });

    let currentIndex = 0;
    let toolUseId = '';
    let toolUseName = '';
    let toolUseInput = '';

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'content_block_start':
          if (chunk.content_block.type === 'tool_use') {
            toolUseId = chunk.content_block.id;
            toolUseName = chunk.content_block.name;
            toolUseInput = '';
          }
          break;

        case 'content_block_delta':
          if (chunk.delta.type === 'text_delta') {
            yield { type: 'text', delta: chunk.delta.text };
          } else if (chunk.delta.type === 'input_json_delta') {
            toolUseInput += chunk.delta.partial_json;
          }
          break;

        case 'content_block_stop':
          if (toolUseId) {
            try {
              const parsed = JSON.parse(toolUseInput);
              yield {
                type: 'tool_use',
                id: toolUseId,
                name: toolUseName,
                input: parsed,
              };
            } catch {
              yield {
                type: 'tool_use',
                id: toolUseId,
                name: toolUseName,
                input: {},
              };
            }
            toolUseId = '';
            toolUseName = '';
            toolUseInput = '';
          }
          break;

        case 'message_delta':
          yield {
            type: 'done',
            stopReason: chunk.delta.stop_reason as 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence',
          };
          break;

        case 'message_stop':
          // End of message
          break;
      }
    }
  }

  private blockToAnthropic(block: ContentBlock): Anthropic.ContentBlockParam {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
        };
    }
  }
}