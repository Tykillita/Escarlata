import { Provider, ProviderOptions, ProviderEvent, Message } from './types.js';
import { ToolDefinition } from '../tools/registry.js';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

interface OllamaToolDef {
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

// Split a Message into Ollama messages, mapping tool_result blocks to
// role:'tool' messages (small local models follow tool results much better
// this way than when results are flattened into user text).
export function toOllamaMessages(msg: Message): OllamaMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: msg.role as OllamaMessage['role'], content: msg.content }];
  }
  const out: OllamaMessage[] = [];
  const texts: string[] = [];
  for (const b of msg.content) {
    if (b.type === 'text') texts.push(b.text);
    else if (b.type === 'tool_result') out.push({ role: 'tool', content: b.content });
  }
  if (texts.length > 0) {
    out.unshift({ role: msg.role as OllamaMessage['role'], content: texts.join('\n') });
  }
  return out;
}

function envNum(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] || '');
  return Number.isFinite(v) ? v : fallback;
}

export class OllamaProvider implements Provider {
  private baseUrl: string;
  private model: string;

  constructor(options: ProviderOptions) {
    this.baseUrl = (options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = options.model || process.env.OLLAMA_MODEL || 'llama3.1';
  }

  async *complete(
    messages: Message[],
    tools?: ToolDefinition[]
  ): AsyncIterable<ProviderEvent> {
    const ollamaMessages: OllamaMessage[] = messages.flatMap(toOllamaMessages);

    const ollamaTools: OllamaToolDef[] | undefined = tools?.map(t => ({
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
      messages: ollamaMessages,
      stream: true,
      // Keep the model loaded between turns — big latency win on local hardware
      keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
      options: {
        temperature: envNum('OLLAMA_TEMPERATURE', 0.7),
        top_p: envNum('OLLAMA_TOP_P', 0.9),
        num_ctx: envNum('OLLAMA_NUM_CTX', 8192),
        num_predict: envNum('OLLAMA_NUM_PREDICT', 1024),
      },
    };
    if (ollamaTools && ollamaTools.length > 0) {
      body.tools = ollamaTools;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(
        `No se pudo conectar con Ollama en ${this.baseUrl}. ¿Está corriendo? ` +
        `Abre la app de Ollama o ejecuta 'ollama serve'.`
      );
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Ollama: no response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let pendingToolCalls: OllamaToolCall[] = [];
    let hasToolCalls = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const chunk = JSON.parse(trimmed);

          if (chunk.message?.content) {
            yield { type: 'text', delta: chunk.message.content };
          }

          if (chunk.message?.tool_calls) {
            hasToolCalls = true;
            pendingToolCalls = chunk.message.tool_calls;
          }

          if (chunk.done) {
            if (hasToolCalls && pendingToolCalls.length > 0) {
              for (const [i, tc] of pendingToolCalls.entries()) {
                const input: Record<string, unknown> =
                  typeof tc.function.arguments === 'string'
                    ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
                    : (tc.function.arguments as Record<string, unknown>);
                yield {
                  type: 'tool_use',
                  id: `ollama_${tc.function.name}_${Date.now()}_${i}`,
                  name: tc.function.name,
                  input,
                };
              }
              yield { type: 'done', stopReason: 'tool_use' };
            } else {
              yield { type: 'done', stopReason: 'end_turn' };
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  }
}

export function createOllamaProvider(options: ProviderOptions): Provider {
  return new OllamaProvider(options);
}
