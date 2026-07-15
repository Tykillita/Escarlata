import { Provider, ProviderOptions, ProviderEvent, Message } from './types.js';
import { ToolDefinition } from '../tools/registry.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export function toOpenAICompatibleMessages(msg: Message): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: msg.role as OpenAIMessage['role'], content: msg.content }];
  }
  const out: OpenAIMessage[] = [];
  for (const b of msg.content) {
    if (b.type === 'text') {
      out.push({ role: msg.role as OpenAIMessage['role'], content: b.text });
    } else if (b.type === 'tool_use') {
      out.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }],
      });
    } else if (b.type === 'tool_result') {
      out.push({ role: 'tool', content: b.content, tool_call_id: b.tool_use_id });
    }
  }
  return out;
}

export class OpenAICompatibleProvider implements Provider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(options: ProviderOptions) {
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = options.model;
    this.apiKey = options.apiKey || '';
  }

  async *complete(
    messages: Message[],
    tools?: ToolDefinition[]
  ): AsyncIterable<ProviderEvent> {
    const apiMessages: OpenAIMessage[] = messages.flatMap(toOpenAICompatibleMessages);

    const apiTools: OpenAIToolDef[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object' as const,
          properties: Object.fromEntries(
            t.parameters.map(p => [p.name, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) }])
          ),
          required: t.parameters.filter(p => p.required).map(p => p.name),
        },
      },
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
      stream: true,
    };
    if (apiTools && apiTools.length > 0) {
      body.tools = apiTools;
    }

    // OpenRouter-specific headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(
        `No se pudo conectar con ${this.baseUrl}. Verifica que el servicio esté disponible.`
      );
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status} from ${this.baseUrl}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { type: 'text', delta: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index as number;
              if (!pendingToolCalls[idx]) {
                pendingToolCalls[idx] = { id: tc.id || `call_${Date.now()}_${idx}`, name: tc.function?.name || '', arguments: '' };
              }
              if (tc.function?.arguments) {
                pendingToolCalls[idx].arguments += tc.function.arguments;
              }
              // Name may come in a later chunk on the same index
              if (tc.function?.name) {
                pendingToolCalls[idx].name = tc.function.name;
              }
            }
          }

          const finish = chunk.choices?.[0]?.finish_reason;
          if (finish === 'tool_calls') {
            for (const [i, tc] of pendingToolCalls.entries()) {
              if (!tc) continue;
              const input: Record<string, unknown> = (() => {
                try { return JSON.parse(tc.arguments); } catch { return {}; }
              })();
              yield {
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input,
              };
            }
            pendingToolCalls = [];
            yield { type: 'done', stopReason: 'tool_use' };
          } else if (finish === 'stop' || finish === 'end_turn' || finish === 'length') {
            yield { type: 'done', stopReason: finish === 'length' ? 'max_tokens' : 'end_turn' };
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  }
}
