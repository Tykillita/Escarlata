import { Tool } from './registry.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import { initializeApp, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore, Query, DocumentData } from 'firebase-admin/firestore';
import { dataPath } from '../config/paths.js';

// Read-only Firestore access to external Firebase projects.
// Drop service account JSON keys into data/firebase/ (one per project);
// the project_id inside each file becomes the project name for the tools.
function getSaDir(): string {
  return process.env.FIREBASE_SA_DIR || dataPath('firebase');
}

const apps: Map<string, App> = new Map();
let loaded = false;

async function loadApps(): Promise<Map<string, App>> {
  if (loaded) return apps;
  loaded = true;
  let files: string[] = [];
  try {
    files = (await fs.readdir(getSaDir())).filter(f => f.endsWith('.json'));
  } catch {
    return apps; // dir missing = no projects configured
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(getSaDir(), file), 'utf-8'));
      if (raw.type !== 'service_account' || !raw.project_id) continue;
      const app = initializeApp({ credential: cert(raw) }, `escarlata-${raw.project_id}`);
      apps.set(raw.project_id, app);
    } catch (err) {
      console.error(`[firebase] failed to load ${file}:`, err);
    }
  }
  return apps;
}

async function getDb(project: string): Promise<Firestore | string> {
  const all = await loadApps();
  if (all.size === 0) {
    return `No hay proyectos Firebase configurados. Coloca los archivos JSON de service account en ${getSaDir()}.`;
  }
  const app = all.get(project);
  if (!app) {
    return `Proyecto "${project}" no encontrado. Proyectos disponibles: ${[...all.keys()].join(', ')}`;
  }
  return getFirestore(app);
}

function formatDoc(id: string, data: DocumentData): string {
  // Firestore Timestamps stringify as {_seconds,_nanoseconds}; emit ISO instead
  const replacer = (_k: string, v: unknown) =>
    v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function'
      ? (v as { toDate: () => Date }).toDate().toISOString()
      : v;
  return `## ${id}\n${JSON.stringify(data, replacer, 1)}`;
}

export const firebaseCollectionsTool: Tool = {
  definition: {
    name: 'firebase_collections',
    description: 'List the connected Firebase projects and the root Firestore collections of one project. Call without arguments to see available projects.',
    parameters: [
      { name: 'project', type: 'string', description: 'Firebase project ID (e.g. "terminal-evertec"). Omit to list available projects.', required: false },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const all = await loadApps();
    if (all.size === 0) {
      return `No hay proyectos Firebase configurados. Coloca los archivos JSON de service account en ${getSaDir()}.`;
    }
    const project = input.project ? String(input.project) : '';
    if (!project) {
      return `Proyectos Firebase conectados:\n${[...all.keys()].map(p => `- ${p}`).join('\n')}`;
    }
    const db = await getDb(project);
    if (typeof db === 'string') return db;
    const cols = await db.listCollections();
    if (cols.length === 0) return `El proyecto "${project}" no tiene colecciones raíz en Firestore.`;
    return `Colecciones en "${project}":\n${cols.map(c => `- ${c.id}`).join('\n')}`;
  },
};

export const firebaseQueryTool: Tool = {
  definition: {
    name: 'firebase_query',
    description: 'Read documents from a Firestore collection in a connected Firebase project (read-only). Supports an optional filter and ordering. Subcollections use slash paths like "users/abc/orders". Collection and field names must be EXACT — if unsure, call firebase_collections first, or query without filter to see the real field names.',
    parameters: [
      { name: 'project', type: 'string', description: 'Firebase project ID', required: true },
      { name: 'collection', type: 'string', description: 'Collection path, e.g. "clientes" or "users/abc/orders"', required: true },
      { name: 'limit', type: 'number', description: 'Max documents to return (default 20, max 50)', required: false },
      { name: 'where_field', type: 'string', description: 'Field name to filter on', required: false },
      { name: 'where_op', type: 'string', description: 'Filter operator', required: false, enum: ['==', '!=', '<', '<=', '>', '>=', 'array-contains', 'in'] },
      { name: 'where_value', type: 'string', description: 'Filter value (numbers and true/false are auto-converted)', required: false },
      { name: 'order_by', type: 'string', description: 'Field to order by, prefix with "-" for descending (e.g. "-createdAt")', required: false },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const db = await getDb(String(input.project || ''));
    if (typeof db === 'string') return db;
    const collection = String(input.collection || '');
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);

    // Small local models guess collection names ("inventario" vs "inventory");
    // resolve loose matches against the real root collections before querying.
    let resolved = collection;
    if (!collection.includes('/')) {
      const cols = (await db.listCollections()).map(c => c.id);
      if (!cols.includes(collection)) {
        const want = collection.toLowerCase();
        const match = cols.filter(c => {
          const have = c.toLowerCase();
          if (have.includes(want) || want.includes(have)) return true;
          let i = 0;
          while (i < have.length && i < want.length && have[i] === want[i]) i++;
          return i >= 4;
        });
        if (match.length === 1) resolved = match[0];
      }
    }

    let q: Query = db.collection(resolved);
    if (input.where_field && input.where_op && input.where_value !== undefined) {
      let value: unknown = String(input.where_value);
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (String(value).trim() !== '' && !isNaN(Number(value))) value = Number(value);
      q = q.where(String(input.where_field), String(input.where_op) as FirebaseFirestore.WhereFilterOp, value);
    }
    if (input.order_by) {
      const field = String(input.order_by);
      q = field.startsWith('-') ? q.orderBy(field.slice(1), 'desc') : q.orderBy(field);
    }
    const snap = await q.limit(limit).get();
    if (snap.empty) {
      // Help the model self-correct: distinguish wrong collection from wrong filter
      const probe = await db.collection(resolved).limit(1).get();
      if (probe.empty) {
        const cols = await db.listCollections();
        return `La colección "${resolved}" no existe. Las colecciones reales son: ${cols.map(c => c.id).join(', ') || 'ninguna'}. VUELVE A LLAMAR firebase_query AHORA MISMO con el nombre correcto de la lista — no le preguntes al usuario.`;
      }
      const fields = Object.keys(probe.docs[0].data()).join(', ');
      return `Sin resultados con ese filtro en "${resolved}". Los campos reales de los documentos son: ${fields}. VUELVE A LLAMAR firebase_query AHORA MISMO con el nombre de campo correcto de esa lista — no le preguntes al usuario.`;
    }
    const docs = snap.docs.map(d => formatDoc(d.id, d.data()));
    return `${snap.size} documento(s) de "${resolved}":\n\n${docs.join('\n\n')}`;
  },
};

export const firebaseGetDocTool: Tool = {
  definition: {
    name: 'firebase_get_doc',
    description: 'Read a single Firestore document by its full path (read-only), e.g. "clientes/abc123".',
    parameters: [
      { name: 'project', type: 'string', description: 'Firebase project ID', required: true },
      { name: 'path', type: 'string', description: 'Document path, e.g. "clientes/abc123"', required: true },
    ],
    requiresConfirmation: false,
  },
  handler: async (input) => {
    const db = await getDb(String(input.project || ''));
    if (typeof db === 'string') return db;
    const docPath = String(input.path || '');
    const snap = await db.doc(docPath).get();
    if (!snap.exists) return `Documento "${docPath}" no existe.`;
    return formatDoc(snap.id, snap.data() as DocumentData);
  },
};
