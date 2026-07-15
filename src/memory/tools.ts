import { Tool, ToolRegistry } from '../tools/registry.js';
import { getMemoryStore } from './store.js';

export const rememberTool: Tool = {
  definition: {
    name: 'remember',
    description: 'Store a durable fact about the user or their preferences that should be remembered across conversations. One fact per call, written as a clear statement.',
    parameters: [
      { name: 'content', type: 'string', description: 'The fact to remember, written as a clear statement (e.g., "User prefers morning meetings")', required: true },
      { name: 'category', type: 'string', description: 'Category of the fact (e.g., preferences, identity, tasks, notes)', required: false },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const content = String(input.content || '').trim();
    const category = String(input.category || 'general');
    const store = getMemoryStore();
    const existing = await store.getAll();
    const dup = existing.find(f => f.content.trim().toLowerCase() === content.toLowerCase());
    if (dup) {
      return `Ya tenía guardado ese dato (${dup.id}): ${dup.content}. No lo duplico.`;
    }
    const fact = await store.add(content, category);
    return `✅ Guardado (${fact.id}): ${content}`;
  },
};

export const recallTool: Tool = {
  definition: {
    name: 'recall',
    description: 'Search through all remembered facts for information matching a query. Use this when you need to remember something about the user or their preferences.',
    parameters: [
      { name: 'query', type: 'string', description: 'What to search for in remembered facts', required: true },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const query = String(input.query || '');
    const store = getMemoryStore();
    const results = await store.search(query);

    if (results.length === 0) {
      return `I don't have any memories matching "${query}".`;
    }

    return `Found ${results.length} memory/ies:\n${results.map(r =>
      `  [${r.category}] ${r.content} (${r.updatedAt.split('T')[0]})`
    ).join('\n')}`;
  },
};

export const listMemoriesTool: Tool = {
  definition: {
    name: 'list_memories',
    description: 'List all remembered facts, optionally filtered by category. Use this to see everything I know about the user.',
    parameters: [
      { name: 'category', type: 'string', description: 'Optional category to filter by', required: false },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const store = getMemoryStore();
    const category = input.category ? String(input.category) : null;
    const facts = category
      ? await store.getByCategory(category)
      : await store.getAll();

    if (facts.length === 0) {
      return category
        ? `No memories in category "${category}".`
        : 'No memories stored yet.';
    }

    return `I have ${facts.length} memory/ies:\n${facts.map(f =>
      `  [${f.id}] (${f.category}) ${f.content}`
    ).join('\n')}`;
  },
};

export const forgetTool: Tool = {
  definition: {
    name: 'forget',
    description: 'Remove a remembered fact. Pass its ID if you know it, or a text query describing the fact; if exactly one memory matches the query it will be removed.',
    parameters: [
      { name: 'id', type: 'string', description: 'ID of the memory to remove (from list_memories), if known', required: false },
      { name: 'query', type: 'string', description: 'Text to identify the memory when the ID is unknown', required: false },
    ],
    requiresConfirmation: true,
    safetyAction: 'forget',
  },
  handler: async (input) => {
    const id = String(input.id || '').trim();
    const query = String(input.query || '').trim();
    const store = getMemoryStore();

    if (id) {
      const removed = await store.remove(id);
      if (removed) return `✅ Memoria ${id} borrada.`;
      if (!query) return `No encontré la memoria "${id}". Usa list_memories para ver los IDs, o pasa un query de texto.`;
    }

    if (!query) return 'Indica el id o un query de texto para identificar qué memoria borrar.';

    const matches = await store.search(query);
    if (matches.length === 0) return `No encontré memorias que coincidan con "${query}".`;
    if (matches.length > 1) {
      return `Hay ${matches.length} memorias que coinciden con "${query}" — dime cuál borrar:\n${matches.map(m => `  [${m.id}] ${m.content}`).join('\n')}`;
    }
    await store.remove(matches[0].id);
    return `✅ Borrado: "${matches[0].content}" (${matches[0].id}).`;
  },
};

export function registerMemoryTools(registry: ToolRegistry): void {
  registry.register(rememberTool);
  registry.register(recallTool);
  registry.register(listMemoriesTool);
  registry.register(forgetTool);
}
