import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Message, Provider, ProviderEvent, ProviderOptions } from './types.js';
import type { ToolDefinition, ToolParameter } from '../tools/registry.js';
import { getProviderAuthService } from './auth-service.js';

class EventQueue {
  private values: ProviderEvent[] = [];
  private waiters: Array<(value: ProviderEvent) => void> = [];

  push(value: ProviderEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  next(): Promise<ProviderEvent> {
    const value = this.values.shift();
    if (value) return Promise.resolve(value);
    return new Promise(resolve => this.waiters.push(resolve));
  }
}

interface PendingTool {
  resolve: (value: { content: Array<{ type: 'text'; text: string }> }) => void;
}

function schemaFor(parameter: ToolParameter): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (parameter.enum?.length) schema = z.enum(parameter.enum as [string, ...string[]]);
  else if (parameter.type === 'number') schema = z.number();
  else if (parameter.type === 'boolean') schema = z.boolean();
  else if (parameter.type === 'array') schema = z.array(z.unknown());
  else if (parameter.type === 'object') schema = z.record(z.string(), z.unknown());
  else schema = z.string();
  schema = schema.describe(parameter.description);
  return parameter.required ? schema : schema.optional();
}

export function renderClaudeTranscript(messages: Message[]): string {
  return messages
    .filter(message => message.role !== 'system')
    .map(message => {
      if (typeof message.content === 'string') return `${message.role.toUpperCase()}: ${message.content}`;
      const content = message.content.map(block => {
        if (block.type === 'text') return block.text;
        if (block.type === 'tool_use') return `[tool ${block.name} ${JSON.stringify(block.input)}]`;
        return `[tool result ${block.tool_use_id}: ${block.content}]`;
      }).join('\n');
      return `${message.role.toUpperCase()}: ${content}`;
    })
    .join('\n\n');
}

export class ClaudeOAuthProvider implements Provider {
  private model: string;
  private cliPath: string;
  private events: EventQueue | null = null;
  private pending = new Map<string, PendingTool>();
  private callSequence = 0;
  private doneScheduled = false;
  private running = false;

  constructor(options: ProviderOptions) {
    this.model = options.model;
    this.cliPath = process.env.CLAUDE_CLI_PATH || 'claude';
  }

  async *complete(messages: Message[], tools: ToolDefinition[] = []): AsyncIterable<ProviderEvent> {
    if (this.running && this.pending.size) {
      const results = new Map<string, string>();
      for (const message of messages) {
        if (typeof message.content === 'string') continue;
        for (const block of message.content) {
          if (block.type === 'tool_result') results.set(block.tool_use_id, block.content);
        }
      }
      for (const [id, pending] of this.pending) {
        const result = results.get(id);
        if (result !== undefined) {
          pending.resolve({ content: [{ type: 'text', text: result }] });
          this.pending.delete(id);
        }
      }
      if (this.pending.size) throw new Error('Claude OAuth esperaba resultados de herramientas que no fueron recibidos');
    } else if (!this.running) {
      this.start(messages, tools);
    }

    const events = this.events;
    if (!events) throw new Error('No se pudo iniciar la sesión OAuth de Claude');
    while (true) {
      const event = await events.next();
      yield event;
      if (event.type === 'done') return;
    }
  }

  private start(messages: Message[], definitions: ToolDefinition[]): void {
    this.running = true;
    this.events = new EventQueue();
    const system = messages.find(message => message.role === 'system');

    const sdkTools = definitions.map(definition => tool(
      definition.name,
      definition.description,
      Object.fromEntries(definition.parameters.map(parameter => [parameter.name, schemaFor(parameter)])),
      async (args: Record<string, unknown>) => {
        const id = `claude_oauth_${++this.callSequence}`;
        const promise = new Promise<{ content: Array<{ type: 'text'; text: string }> }>(resolve => {
          this.pending.set(id, { resolve });
        });
        this.events?.push({ type: 'tool_use', id, name: definition.name, input: args });
        if (!this.doneScheduled) {
          this.doneScheduled = true;
          setTimeout(() => {
            this.doneScheduled = false;
            this.events?.push({ type: 'done', stopReason: 'tool_use' });
          }, 0);
        }
        return promise;
      },
      { alwaysLoad: true },
    ));

    const server = createSdkMcpServer({
      name: 'escarlata',
      version: '1.0.0',
      tools: sdkTools,
      alwaysLoad: true,
    });

    const session = query({
      prompt: renderClaudeTranscript(messages),
      options: {
        model: this.model,
        systemPrompt: typeof system?.content === 'string' ? system.content : '',
        pathToClaudeCodeExecutable: this.cliPath,
        mcpServers: { escarlata: server },
        strictMcpConfig: true,
        settingSources: [],
        tools: definitions.map(definition => `mcp__escarlata__${definition.name}`),
        allowedTools: definitions.map(definition => `mcp__escarlata__${definition.name}`),
        permissionMode: 'dontAsk',
        includePartialMessages: true,
        persistSession: false,
        maxTurns: 8,
      },
    });

    void (async () => {
      let streamed = false;
      try {
        for await (const message of session) {
          if (message.type === 'stream_event') {
            const event: any = message.event;
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              streamed = true;
              this.events?.push({ type: 'text', delta: event.delta.text });
            }
          } else if (message.type === 'assistant' && message.error) {
            throw new Error(`Claude OAuth: ${message.error}`);
          } else if (message.type === 'result') {
            if (message.is_error) {
              const detail = 'errors' in message ? message.errors.join('; ') : 'falló la generación';
              throw new Error(`Claude OAuth: ${detail}`);
            }
            if (!streamed && 'result' in message && message.result) {
              this.events?.push({ type: 'text', delta: message.result });
            }
            this.events?.push({ type: 'done', stopReason: 'end_turn' });
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const expired = /authentication|oauth|login|unauthorized|401/i.test(detail);
        getProviderAuthService().report('anthropic', expired ? 'La sesión de Claude expiró; vuelve a conectarla' : detail, expired);
        this.events?.push({
          type: 'text',
          delta: `No pude usar la sesión OAuth de Claude: ${detail}`,
        });
        this.events?.push({ type: 'done', stopReason: 'end_turn' });
      } finally {
        this.running = false;
        this.pending.clear();
      }
    })();
  }
}
