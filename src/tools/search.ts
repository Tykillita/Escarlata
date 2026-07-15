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

// Resultado de un proveedor de búsqueda: distinguimos "no encontró nada" (ok con
// texto vacío) de "el proveedor falló" — el modelo nunca debe confundir ambos.
type SearchOutcome = { ok: true; text: string } | { ok: false; error: string };

async function fetchWithTimeout(url: string, init: RequestInit, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Brave Search API (opcional, BRAVE_SEARCH_API_KEY). Null = no configurado. */
async function searchBrave(query: string): Promise<SearchOutcome | null> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;
  try {
    const response = await fetchWithTimeout(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
      { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } },
    );
    if (!response.ok) return { ok: false, error: `Brave respondió ${response.status}` };
    const data = await response.json() as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    const results = (data.web?.results || [])
      .filter(r => r.title)
      .map(r => `${r.title}\n  ${r.url || ''}\n  ${r.description || '(sin extracto)'}`);
    return { ok: true, text: results.slice(0, 8).join('\n\n') };
  } catch (err) {
    return { ok: false, error: `Brave: ${err instanceof Error ? err.message : 'fallo de red'}` };
  }
}

/** Instancia SearXNG propia (opcional, SEARXNG_BASE_URL). Null = no configurado. */
async function searchSearx(query: string): Promise<SearchOutcome | null> {
  const base = process.env.SEARXNG_BASE_URL?.replace(/\/+$/, '');
  if (!base) return null;
  try {
    const response = await fetchWithTimeout(`${base}/search?q=${encodeURIComponent(query)}&format=json`, {});
    if (!response.ok) return { ok: false, error: `SearXNG respondió ${response.status}` };
    const data = await response.json() as { results?: { title?: string; url?: string; content?: string }[] };
    const results = (data.results || [])
      .filter(r => r.title)
      .map(r => `${r.title}\n  ${r.url || ''}\n  ${r.content || '(sin extracto)'}`);
    return { ok: true, text: results.slice(0, 8).join('\n\n') };
  } catch (err) {
    return { ok: false, error: `SearXNG: ${err instanceof Error ? err.message : 'fallo de red'}` };
  }
}

/** Scraping del HTML de DuckDuckGo — último recurso, sin API key. */
async function searchDuckDuckGo(query: string): Promise<SearchOutcome> {
  try {
    const response = await fetchWithTimeout('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: query }).toString(),
    });
    if (!response.ok) return { ok: false, error: `DuckDuckGo respondió ${response.status}` };
    const html = await response.text();
    const $ = cheerio.load(html);
    const results: string[] = [];
    $('.result').each((_, el) => {
      const title = $(el).find('.result__title a').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      const url = $(el).find('.result__url').text().trim() || $(el).find('.result__title a').attr('href') || '';
      if (title) {
        const cleanUrl = url.replace(/^\/\/?/, '');
        results.push(`${title}\n  ${cleanUrl}\n  ${snippet || '(sin extracto)'}`);
      }
    });
    // Página válida pero sin bloques .result: o no hay resultados o DDG cambió
    // el markup. Sin forma de distinguirlo, lo reportamos como cero resultados.
    return { ok: true, text: results.slice(0, 8).join('\n\n') };
  } catch (err) {
    return { ok: false, error: `DuckDuckGo: ${err instanceof Error ? err.message : 'fallo de red'}` };
  }
}

async function searchWeb(query: string): Promise<SearchOutcome> {
  const errors: string[] = [];
  for (const provider of [searchBrave, searchSearx, searchDuckDuckGo]) {
    const outcome = await provider(query);
    if (outcome === null) continue; // proveedor no configurado
    if (outcome.ok && outcome.text) return outcome;
    if (outcome.ok) return outcome; // sin resultados: no probamos el siguiente para no duplicar "vacío"
    errors.push(outcome.error);
  }
  return { ok: false, error: errors.join('; ') || 'ningún proveedor disponible' };
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
    const web = await searchWeb(query);

    if (!web.ok) {
      // Fallo ≠ cero resultados: el modelo debe decir que no pudo buscar, no que no hay nada.
      const failure = `La búsqueda web falló (${web.error}). No puedo confirmar si existen resultados; informa al usuario del fallo en vez de afirmar que no hay nada.`;
      return localResults ? `${localResults}\n\n---\n\n${failure}` : failure;
    }
    const parts = [localResults, web.text].filter(Boolean);
    if (parts.length === 0) {
      return `Sin resultados para "${query}".`;
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
    if (!filename.trim()) return 'Indica el nombre del archivo.';
    if (!content.trim()) return 'Indica el contenido a escribir.';
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
      return `Archivo "${normalized}" guardado (${content.length} bytes).`;
    } catch (err) {
      return `Error al escribir el archivo: ${err instanceof Error ? err.message : String(err)}`;
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
    if (!filename.trim()) return 'Indica qué archivo leer (ej: "notes.txt", "readme.md", "subcarpeta/nota.md").';
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
      return `No encontré el archivo "${normalized}" en el directorio de documentos.`;
    }
  },
};
