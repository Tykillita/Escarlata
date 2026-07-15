import { Tool } from './registry.js';
import { promises as fs } from 'fs';
import * as path from 'path';

// Read-only access to stored conversations (data/conversations/) so Amatista
// can mine past chats for durable facts. Only registered to her profile.

const CONV_DIR = process.env.CONVERSATIONS_DIR || path.join(process.cwd(), 'data', 'conversations');

interface ConvIndexEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

type StoredMessage = {
  role: string;
  content: string | Array<{ type: string; text?: string; content?: unknown }>;
};

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
    let index: ConvIndexEntry[];
    try {
      index = JSON.parse(await fs.readFile(path.join(CONV_DIR, 'index.json'), 'utf-8'));
    } catch {
      return 'No hay conversaciones guardadas.';
    }
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
    let messages: StoredMessage[];
    try {
      messages = JSON.parse(await fs.readFile(path.join(CONV_DIR, `${id}.json`), 'utf-8'));
    } catch {
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
