import { Tool } from './registry.js';
import { promises as fs } from 'fs';
import * as path from 'path';

interface DirectiveItem {
  text: string;
  checked: boolean;
}

async function getTodoPath(): Promise<string> {
  const configured = process.env.ESCARLATA_DIRECTIVES_FILE?.trim();
  if (configured) return path.resolve(configured);
  const vault = process.env.OBSIDIAN_VAULT || '';
  if (!vault) throw new Error('OBSIDIAN_VAULT no configurado');
  const current = path.join(vault, 'directives', 'pending.md');
  try { await fs.access(current); return current; } catch { /* Try the pre-desktop location below. */ }
  const legacy = path.join(vault, 'Escarlata', 'DIRECTIVES', 'TODO-LIST.md');
  try { await fs.access(legacy); return legacy; } catch { return current; }
}

export async function readDirectives(): Promise<DirectiveItem[]> {
  let todoPath: string;
  try { todoPath = await getTodoPath(); } catch { return []; }
  try {
    const content = await fs.readFile(todoPath, 'utf-8');
    const items: DirectiveItem[] = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^- \[(.)\]\s*(.+)/);
      if (match) {
        const text = match[2]
          .replace(/<mark[^>]*>/g, '')
          .replace(/<\/mark>/g, '')
          .replace(/\[\[([^\]]+)\]\]/g, '$1')
          .trim();
        if (text) items.push({ text, checked: match[1] === 'x' });
      }
    }
    return items;
  } catch {
    return [];
  }
}

async function appendToTodo(task: string): Promise<string> {
  let todoPath: string;
  try { todoPath = await getTodoPath(); } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
  await fs.mkdir(path.dirname(todoPath), { recursive: true });
  let content = '';
  try { content = await fs.readFile(todoPath, 'utf-8'); } catch {}
  const existing = await readDirectives();
  if (existing.some(i => i.text.toLowerCase() === task.toLowerCase())) {
    return `La tarea "${task}" ya existe en el TODO-LIST.`;
  }
  const newLine = `- [ ] ${task}\n`;
  content += newLine;
  await fs.writeFile(todoPath, content, 'utf-8');
  return `Tarea "${task}" agregada al TODO-LIST.`;
}

async function markTodoDone(task: string): Promise<string> {
  let todoPath: string;
  try { todoPath = await getTodoPath(); } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
  const content = await fs.readFile(todoPath, 'utf-8').catch(() => '');
  if (!content) return 'El TODO-LIST está vacío o no existe.';
  const lines = content.split('\n');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^- \[(.)\]\s*(.+)/);
    if (match) {
      const text = match[2]
        .replace(/<mark[^>]*>/g, '').replace(/<\/mark>/g, '')
        .replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
      if (text.toLowerCase() === task.toLowerCase()) {
        lines[i] = lines[i].replace(/^- \[.\]\s*/, '- [x] ');
        found = true;
        break;
      }
    }
  }
  if (!found) return `No se encontró la tarea "${task}" en el TODO-LIST.`;
  await fs.writeFile(todoPath, lines.join('\n'), 'utf-8');
  return `Tarea "${task}" marcada como completada.`;
}

export const getDirectivesTool: Tool = {
  definition: {
    name: 'get_directives',
    description: 'Lee los pendientes y directivas del TODO-LIST de la bóveda de Obsidian. Úsalo cuando el usuario pregunte qué tiene pendiente, qué debe hacer, o cuáles son sus tareas.',
    parameters: [],
    requiresConfirmation: false,
  },
  handler: async () => {
    const items = await readDirectives();
    if (items.length === 0) return 'No hay pendientes registrados en el TODO-LIST.';
    const pending = items.filter(i => !i.checked);
    const done = items.filter(i => i.checked);
    const lines: string[] = [];
    if (pending.length > 0) {
      lines.push('**Pendientes:**');
      pending.forEach(i => lines.push(`- [ ] ${i.text}`));
    }
    if (done.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('**Completados:**');
      done.forEach(i => lines.push(`- [x] ${i.text}`));
    }
    return lines.join('\n');
  },
};

export const addTodoTool: Tool = {
  definition: {
    name: 'add_todo',
    description: 'Agrega una tarea nueva al TODO-LIST de la bóveda de Obsidian. Úsalo cuando el usuario pida agregar un pendiente, tarea, o cosa por hacer.',
    parameters: [
      { name: 'task', type: 'string', description: 'La descripción de la tarea a agregar', required: true },
    ],
    requiresConfirmation: false,
    safetyAction: 'modify_file',
  },
  handler: async (input) => {
    const task = String(input.task || '').trim();
    if (!task) return 'Especifica qué tarea quieres agregar.';
    return await appendToTodo(task);
  },
};

export const doneTodoTool: Tool = {
  definition: {
    name: 'done_todo',
    description: 'Marca una tarea del TODO-LIST como completada. Úsalo cuando el usuario diga que terminó algo o completó un pendiente.',
    parameters: [
      { name: 'task', type: 'string', description: 'La descripción exacta de la tarea a marcar como completada', required: true },
    ],
    requiresConfirmation: false,
    safetyAction: 'modify_file',
  },
  handler: async (input) => {
    const task = String(input.task || '').trim();
    if (!task) return 'Especifica qué tarea quieres marcar como completada.';
    return await markTodoDone(task);
  },
};
