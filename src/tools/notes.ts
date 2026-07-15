import { Tool } from './registry.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import { dataPath } from '../config/paths.js';

function getNotesDir(): string {
  return process.env.NOTES_DIR || dataPath('notes');
}

async function ensureDir() {
  await fs.mkdir(getNotesDir(), { recursive: true });
}

async function getNotesPath(file: string): Promise<string> {
  // Sanitize: prevent path traversal
  const safe = file.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getNotesDir(), `${safe}.md`);
}

async function listAllNotes(): Promise<string[]> {
  await ensureDir();
  const files = await fs.readdir(getNotesDir());
  return files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
}

export const saveNoteTool: Tool = {
  definition: {
    name: 'save_note',
    description: 'Save a note with a title and content for future reference. Use this when the user says "remember this", "take a note", or "save this".',
    parameters: [
      { name: 'title', type: 'string', description: 'Short title for the note', required: true },
      { name: 'content', type: 'string', description: 'The note content to save', required: true },
    ],
    requiresConfirmation: false,
    safetyAction: 'modify_file',
  },
  handler: async (input) => {
    const title = String(input.title || 'untitled');
    const content = String(input.content || '');
    const filePath = await getNotesPath(title);
    await ensureDir();
    const timestamp = new Date().toISOString();
    const entry = `# ${title}\n> Created: ${timestamp}\n\n${content}\n`;
    await fs.writeFile(filePath, entry, 'utf-8');
    return `Note "${title}" saved successfully.`;
  },
};

export const getNoteTool: Tool = {
  definition: {
    name: 'get_note',
    description: 'Retrieve the content of a previously saved note by its title.',
    parameters: [
      { name: 'title', type: 'string', description: 'Title of the note to retrieve', required: true },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const title = String(input.title || '');
    const filePath = await getNotesPath(title);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch {
      return `Note "${title}" not found. Available notes: ${(await listAllNotes()).join(', ') || 'none'}`;
    }
  },
};

export const listNotesTool: Tool = {
  definition: {
    name: 'list_notes',
    description: 'List all saved note titles. Use this to see what notes exist before retrieving one.',
    parameters: [],
    requiresConfirmation: false,
  },
  handler: async () => {
    const notes = await listAllNotes();
    if (notes.length === 0) return 'No notes saved yet.';
    return 'Available notes:\n' + notes.map(n => `- ${n}`).join('\n');
  },
};

export const searchNotesTool: Tool = {
  definition: {
    name: 'search_notes',
    description: 'Search through all saved notes for a specific keyword or phrase. Use this to find relevant information across notes.',
    parameters: [
      { name: 'query', type: 'string', description: 'Keyword or phrase to search for', required: true },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const query = String(input.query || '').toLowerCase();
    await ensureDir();
    const files = await fs.readdir(getNotesDir());
    const results: string[] = [];

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(path.join(getNotesDir(), file), 'utf-8');
      if (content.toLowerCase().includes(query)) {
        const title = file.replace(/\.md$/, '');
        // Find the matching snippet
        const lines = content.split('\n');
        const matchLine = lines.findIndex(l => l.toLowerCase().includes(query));
        results.push(`"${title}": ${matchLine >= 0 ? lines[matchLine].trim().slice(0, 150) : '(match)'}`);
      }
    }

    if (results.length === 0) return `No notes found matching "${query}".`;
    return `Found in ${results.length} note(s):\n${results.join('\n')}`;
  },
};
