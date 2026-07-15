import { Tool } from './registry.js';
import * as path from 'path';
import { promises as fs } from 'fs';
import * as cheerio from 'cheerio';
import { dataPath } from '../config/paths.js';

function getLocalDocsDir(): string {
  return process.env.LOCAL_DOCS_DIR || dataPath('docs');
}

/** Resolve a user-supplied relative path inside baseDir, or null if it escapes it. */
function resolveInside(baseDir: string, relPath: string): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relPath);
  const rel = path.relative(base, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

// Search local documentation files for matches
async function searchLocalDocs(query: string): Promise<string> {
  try {
    const docsDir = getLocalDocsDir();
    await fs.mkdir(docsDir, { recursive: true });
    const files = await fs.readdir(docsDir);
    const results: { file: string; snippet: string }[] = [];

    for (const file of files) {
      if (!file.match(/\.(txt|md|json|csv|log)$/)) continue;
      const content = await fs.readFile(path.join(docsDir, file), 'utf-8');
      const lines = content.split('\n');
      const lowerQuery = query.toLowerCase();

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);
          const snippet = lines.slice(start, end).join('\n').trim().slice(0, 300);
          results.push({ file, snippet: `...${snippet}...` });
          if (results.length >= 5) break;
        }
      }
      if (results.length >= 5) break;
    }

    if (results.length === 0) return '';
    return 'Local docs results:\n' + results
      .map(r => `[${r.file}]: ${r.snippet}`)
      .join('\n\n');
  } catch {
    return '';
  }
}

async function searchDuckDuckGo(query: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: query }).toString(),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return '';
    const html = await response.text();
    const $ = cheerio.load(html);
    const results: string[] = [];
    $('.result').each((_, el) => {
      const title = $(el).find('.result__title a').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      const url = $(el).find('.result__url').text().trim() || $(el).find('.result__title a').attr('href') || '';
      if (title) {
        const cleanUrl = url.replace(/^\/\/?/, '');
        results.push(`${title}\n  ${cleanUrl}\n  ${snippet || '(no preview)'}`);
      }
    });
    if (results.length === 0) return '';
    return results.slice(0, 8).join('\n\n');
  } catch {
    return '';
  }
}

export const webSearchTool: Tool = {
  definition: {
    name: 'web_search',
    description: 'Search the web for current information, news, or answers. Use this when you don\'t know something or the user asks about recent events or facts.',
    parameters: [
      { name: 'query', type: 'string', description: 'The search query', required: true },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const query = String(input.query || '');

    const localResults = await searchLocalDocs(query);
    const webResults = await searchDuckDuckGo(query);

    const parts = [localResults, webResults].filter(Boolean);
    if (parts.length === 0) {
      return `No results found for "${query}".`;
    }
    return parts.join('\n\n---\n\n');
  },
};

export const editLocalFileTool: Tool = {
  definition: {
    name: 'edit_local_file',
    description: 'Write, append, or update a file in the local docs directory (Obsidian vault). Use this when the user asks to save, update, edit, or modify a file. For creating new notes use save_note instead.',
    parameters: [
      { name: 'filename', type: 'string', description: 'Path to the file relative to the vault (e.g., "notes.txt", "subfolder/doc.md")', required: true },
      { name: 'content', type: 'string', description: 'The full new content to write to the file', required: true },
    ],
    requiresConfirmation: true,
    safetyAction: 'modify_file',
  },
  handler: async (input) => {
    let filename = String(input.filename || input.path || '');
    const content = String(input.content || '');
    if (!filename.trim()) return 'Please specify a filename.';
    if (!content.trim()) return 'Please provide content to write.';
    let normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
    // Alias: filenames that ARE the todo list (not just contain "todo") go to TODO-LIST.md
    const vaultDir = process.env.OBSIDIAN_VAULT || '';
    const base = normalized.split('/').pop() || '';
    if (/^todo([-_ ]?list)?(\.md)?$/i.test(base) && vaultDir) {
      const todoPath = path.join(vaultDir, 'Escarlata', 'DIRECTIVES', 'TODO-LIST.md');
      await fs.mkdir(path.dirname(todoPath), { recursive: true });
      await fs.writeFile(todoPath, content, 'utf-8');
      return `TODO-LIST.md actualizado (${content.length} bytes).`;
    }
    const filePath = resolveInside(getLocalDocsDir(), normalized);
    if (!filePath) return 'Acceso denegado: la ruta sale del directorio permitido.';
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return `File "${normalized}" saved successfully (${content.length} bytes).`;
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const readLocalFileTool: Tool = {
  definition: {
    name: 'read_local_file',
    description: 'Read the contents of a file from the local documentation directory. Use this to look up information stored in your local files.',
    parameters: [
      { name: 'filename', type: 'string', description: 'Name of the file to read (e.g., "notes.txt", "readme.md")', required: true },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const filename = String(input.filename || input.path || '');
    if (!filename.trim()) return 'Please specify a filename to read (e.g., "notes.txt", "readme.md", "subfolder/note.md").';
    // Sanitize: prevent path traversal (allow subdirectories)
    const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
    const filePath = resolveInside(getLocalDocsDir(), normalized);
    if (!filePath) return 'Acceso denegado: la ruta sale del directorio permitido.';

    try {
      // Verify the resolved path (symlinks included) is still within the docs dir
      const resolved = await fs.realpath(filePath);
      const baseDir = await fs.realpath(getLocalDocsDir());
      const rel = path.relative(baseDir, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return 'Acceso denegado: la ruta sale del directorio permitido.';
      }
      const content = await fs.readFile(resolved, 'utf-8');
      return content.slice(0, 4000); // Limit size
    } catch {
      return `File "${normalized}" not found in local docs directory.`;
    }
  },
};
