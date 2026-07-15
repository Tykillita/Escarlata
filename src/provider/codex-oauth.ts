import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { Message, Provider, ProviderEvent, ProviderOptions } from './types.js';
import type { ToolDefinition } from '../tools/registry.js';
import { getCodexAppServer } from './codex-app-server.js';
import { getProviderAuthService } from './auth-service.js';

class EventQueue {
  private values: ProviderEvent[] = [];
  private waiters: Array<(value: ProviderEvent) => void> = [];
  push(value: ProviderEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value); else this.values.push(value);
  }
  next(): Promise<ProviderEvent> {
    const value = this.values.shift();
    return value ? Promise.resolve(value) : new Promise(resolve => this.waiters.push(resolve));
  }
}

interface PendingCall { requestId: number; callId: string }

function renderMessages(messages: Message[]): string {
  return messages.map(message => {
    const content = typeof message.content === 'string'
      ? message.content
      : message.content.map(block => {
          if (block.type === 'text') return block.text;
          if (block.type === 'tool_use') return `[tool ${block.name}: ${JSON.stringify(block.input)}]`;
          return `[tool result ${block.tool_use_id}: ${block.content}]`;
        }).join('\n');
    return `${message.role.toUpperCase()}: ${content}`;
  }).join('\n\n');
}

export function renderCodexTurn(messages: Message[]): { developerInstructions: string; input: string } {
  const system = messages.find(message => message.role === 'system');
  const conversation = messages.filter(message => message.role !== 'system');
  return {
    developerInstructions: typeof system?.content === 'string' ? system.content : '',
    input: renderMessages(conversation),
  };
}

export class CodexOAuthProvider implements Provider {
  private model: string;
  private events: EventQueue | null = null;
  private threadId: string | null = null;
  private pending = new Map<string, PendingCall>();
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private toolDoneScheduled = false;
  private turnError: string | null = null;

  constructor(options: ProviderOptions) {
    this.model = options.model;
  }

  async *complete(messages: Message[], tools: ToolDefinition[] = []): AsyncIterable<ProviderEvent> {
    const client = getCodexAppServer();
    await client.ensureStarted();

    if (this.running && this.pending.size) {
      const results = new Map<string, string>();
      for (const message of messages) {
        if (typeof message.content === 'string') continue;
        for (const block of message.content) {
          if (block.type === 'tool_result') results.set(block.tool_use_id, block.content);
        }
      }
      for (const [id, call] of this.pending) {
        const result = results.get(id);
        if (result === undefined) continue;
        client.respond(call.requestId, {
          contentItems: [{ type: 'inputText', text: result }],
          success: !result.startsWith('Error'),
        });
        this.pending.delete(id);
      }
      if (this.pending.size) throw new Error('Codex OAuth esperaba resultados de herramientas que no fueron recibidos');
    } else if (!this.running) {
      await this.start(messages, tools);
    }

    const events = this.events;
    if (!events) throw new Error('No se pudo iniciar la sesión OAuth de Codex');
    while (true) {
      const event = await events.next();
      yield event;
      if (event.type === 'done') return;
    }
  }

  private async start(messages: Message[], tools: ToolDefinition[]): Promise<void> {
    const client = getCodexAppServer();
    const cwd = path.join(os.tmpdir(), 'escarlata-codex-oauth');
    await fs.mkdir(cwd, { recursive: true });
    this.events = new EventQueue();
    this.running = true;
    const rendered = renderCodexTurn(messages);

    this.unsubscribe?.();
    this.unsubscribe = client.onMessage(message => {
      const params = message.params || {};
      if (params.threadId && params.threadId !== this.threadId) return;

      if (message.method === 'item/agentMessage/delta' && params.delta) {
        this.events?.push({ type: 'text', delta: String(params.delta) });
      } else if (message.method === 'item/tool/call' && typeof message.id === 'number') {
        const id = String(params.callId || `codex_oauth_${message.id}`);
        this.pending.set(id, { requestId: message.id, callId: id });
        this.events?.push({
          type: 'tool_use',
          id,
          name: String(params.tool || ''),
          input: (params.arguments || {}) as Record<string, unknown>,
        });
        if (!this.toolDoneScheduled) {
          this.toolDoneScheduled = true;
          setTimeout(() => {
            this.toolDoneScheduled = false;
            this.events?.push({ type: 'done', stopReason: 'tool_use' });
          }, 0);
        }
      } else if (message.method === 'error') {
        this.turnError = String(params.error?.message || 'Falló la sesión OAuth de ChatGPT');
      } else if (message.method === 'turn/completed') {
        const turn = params.turn || {};
        const error = this.turnError || turn.error?.message;
        if (turn.status === 'failed' || error) {
          const detail = String(error || 'Falló la sesión OAuth de ChatGPT');
          const expired = /unauthorized|authentication|login|401/i.test(detail);
          getProviderAuthService().report('openai', expired ? 'La sesión de ChatGPT expiró; vuelve a conectarla' : detail, expired);
          this.events?.push({ type: 'text', delta: `No pude usar la sesión OAuth de ChatGPT: ${detail}` });
        }
        this.events?.push({ type: 'done', stopReason: 'end_turn' });
        this.finish();
      } else if (typeof message.id === 'number' && message.method) {
        // Native Codex actions and elicitations are deliberately unavailable here.
        client.respond(message.id, { decision: 'decline', action: 'decline', content: null });
      }
    });

    try {
      const threadResult = await client.request('thread/start', {
        model: this.model,
        cwd,
        ephemeral: true,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        personality: 'none',
        developerInstructions: rendered.developerInstructions,
        dynamicTools: tools.map(definition => ({
          type: 'function',
          name: definition.name,
          description: definition.description,
          inputSchema: {
            type: 'object',
            properties: Object.fromEntries(definition.parameters.map(parameter => [parameter.name, {
              type: parameter.type,
              description: parameter.description,
              ...(parameter.enum ? { enum: parameter.enum } : {}),
            }])),
            required: definition.parameters.filter(parameter => parameter.required).map(parameter => parameter.name),
            additionalProperties: false,
          },
        })),
      });
      this.threadId = threadResult.thread.id;
      await client.request('turn/start', {
        threadId: this.threadId,
        input: [{ type: 'text', text: rendered.input }],
      });
    } catch (error) {
      this.finish();
      throw error;
    }
  }

  private finish(): void {
    this.running = false;
    this.threadId = null;
    this.pending.clear();
    this.turnError = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
