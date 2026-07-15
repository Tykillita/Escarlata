import OpenAI from 'openai';
import type { Message, Provider, ProviderEvent, ProviderOptions } from './types.js';
import type { ToolDefinition } from '../tools/registry.js';

export function toOpenAIMessages(messages: Message[]): any[] {
  return messages.flatMap(message => {
    if (typeof message.content === 'string') {
      return [{ role: message.role, content: message.content }];
    }

    const out: any[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        out.push({ role: message.role, content: block.text });
      } else if (block.type === 'tool_use') {
        out.push({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          }],
        });
      } else {
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
      }
    }
    return out;
  });
}

export class OpenAIProvider implements Provider {
  private client: OpenAI;
  private model: string;

  constructor(options: ProviderOptions) {
    if (!options.apiKey) throw new Error('API key required for OpenAI provider');
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl });
    this.model = options.model;
  }

  async *complete(messages: Message[], tools?: ToolDefinition[]): AsyncIterable<ProviderEvent> {
    const apiTools = tools?.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(tool.parameters.map(parameter => [parameter.name, {
            type: parameter.type,
            description: parameter.description,
            ...(parameter.enum ? { enum: parameter.enum } : {}),
          }])),
          required: tool.parameters.filter(parameter => parameter.required).map(parameter => parameter.name),
          additionalProperties: false,
        },
      },
    }));

    const stream: any = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(messages),
      tools: apiTools?.length ? apiTools : undefined,
      stream: true,
    } as any);

    const pending: Array<{ id: string; name: string; arguments: string }> = [];
    let emittedDone = false;
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) yield { type: 'text', delta: delta.content };

      for (const call of delta?.tool_calls || []) {
        const index = call.index || 0;
        pending[index] ||= { id: call.id || `call_${Date.now()}_${index}`, name: '', arguments: '' };
        if (call.id) pending[index].id = call.id;
        if (call.function?.name) pending[index].name = call.function.name;
        if (call.function?.arguments) pending[index].arguments += call.function.arguments;
      }

      if (choice?.finish_reason === 'tool_calls') {
        for (const call of pending) {
          if (!call) continue;
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(call.arguments || '{}'); } catch {}
          yield { type: 'tool_use', id: call.id, name: call.name, input };
        }
        emittedDone = true;
        yield { type: 'done', stopReason: 'tool_use' };
      } else if (choice?.finish_reason) {
        emittedDone = true;
        yield {
          type: 'done',
          stopReason: choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
        };
      }
    }

    if (!emittedDone) yield { type: 'done', stopReason: 'end_turn' };
  }
}
