import { Tool } from './registry.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import { dataPath } from '../config/paths.js';

// Read-only access to stored conversations so Amatista can mine past chats
// for durable facts. Only registered to her profile.
//
// The storage backend is pluggable: the desktop injects a SQLite-backed
// source (LocalStore) via setConversationSource(); without injection the
// tools fall back to the legacy JSON directory used by the CLI and tests.

export interface ConversationSummaryEntry {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export type StoredMessage = {
  role: string;
  content: string | Array<{ type: string; text?: string; content?: unknown }>;
};

export interface ConversationSource {
  list(): ConversationSummaryEntry[] | Promise<ConversationSummaryEntry[]>;
  /** null cuando la conversación no existe */
  read(id: string): StoredMessage[] | null | Promise<StoredMessage[] | null>;
}

function getConvDir(): string {
  return process.env.CONVERSATIONS_DIR || dataPath('conversations');
}

const jsonDirSource: ConversationSource = {
  async list() {
    try {
      const index = JSON.parse(await fs.readFile(path.join(getConvDir(), 'index.json'), 'utf-8')) as ConversationSummaryEntry[];
      return index;
    } catch {
      return [];
    }
  },
  async read(id: string) {
    try {
      return JSON.parse(await fs.readFile(path.join(getConvDir(), `${id}.json`), 'utf-8')) as StoredMessage[];
    } catch {
      return null;
    }
  },
};

let activeSource: ConversationSource = jsonDirSource;

/** El desktop inyecta aquí su almacén real (SQLite) al arrancar. */
export function setConversationSource(source: ConversationSource): void {
  activeSource = source;
}

function blockText(content: StoredMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map(b => (b.type === 'text' && b.text) ? b.text : '')
    .filter(Boolean)
    .join('\n');
}

export const listConversationsTool: Tool = {
  definition: {
    name: 'list_conversations',
    description: 'Lista las conversaciones guardadas (id, título, fecha, cantidad de mensajes), de la más reciente a la más antigua.',
    parameters: [
      { name: 'limit', type: 'number', description: 'Máximo de conversaciones a listar (default 10)', required: false },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(50, input.limit)) : 10;
    const index = await activeSource.list();
    if (index.length === 0) return 'No hay conversaciones guardadas.';
    const rows = index.slice(0, limit).map(c => {
      const title = c.title.replace(/\[[^\]]*\]\s*/g, '').replace(/\n/g, ' ').slice(0, 60);
      return `- ${c.id} (${c.updatedAt.split('T')[0]}, ${c.messageCount} mensajes): ${title}`;
    });
    return `Conversaciones (${Math.min(limit, index.length)} de ${index.length}):\n${rows.join('\n')}`;
  },
};

export const readConversationTool: Tool = {
  definition: {
    name: 'read_conversation',
    description: 'Lee el contenido de una conversación guardada por su id (de list_conversations). Devuelve los turnos usuario/asistente como texto.',
    parameters: [
      { name: 'id', type: 'string', description: 'Id de la conversación', required: true },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const id = String(input.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) return 'Indica el id de la conversación.';
    const messages = await activeSource.read(id);
    if (!messages || messages.length === 0) {
      return `No encontré la conversación "${id}". Usa list_conversations para ver los ids.`;
    }
    const turns = messages
      .map(m => {
        const text = blockText(m.content).trim();
        if (!text) return '';
        const who = m.role === 'user' ? 'USUARIO' : 'ESCARLATA';
        return `${who}: ${text}`;
      })
      .filter(Boolean)
      .join('\n---\n');
    // Cap size so a long chat doesn't blow the subagent's context
    return turns.slice(0, 6000) + (turns.length > 6000 ? '\n[...conversación truncada]' : '');
  },
};
