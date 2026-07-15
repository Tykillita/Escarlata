import { promises as fs } from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

/** Acción rápida: la UI la muestra como botón y manda `command` como mensaje al agente */
export interface NoticeAction {
  label: string;
  command: string;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'notice' | 'important';
  source: string; // which check produced it
  createdAt: string;
  dismissed: boolean;
  actions?: NoticeAction[];
}

const NOTICES_FILE = process.env.NOTICES_FILE || path.join(process.cwd(), 'data', 'notices.json');

function getNoticesPath(): string {
  return process.env.NOTICES_FILE || path.join(process.cwd(), 'data', 'notices.json');
}

/** Retención: los descartados se podan pasados 7 días */
const DISMISSED_RETENTION_MS = 7 * 24 * 3600000;

export class NoticeBoard extends EventEmitter {
  private notices: Notice[] = [];
  private loaded = false;

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(getNoticesPath(), 'utf-8');
      this.notices = JSON.parse(data);
    } catch {
      this.notices = [];
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    // Poda de descartados viejos — el archivo no crece para siempre
    const cutoff = Date.now() - DISMISSED_RETENTION_MS;
    this.notices = this.notices.filter(n => !n.dismissed || new Date(n.createdAt).getTime() > cutoff);
    await fs.mkdir(path.dirname(getNoticesPath()), { recursive: true });
    await fs.writeFile(getNoticesPath(), JSON.stringify(this.notices, null, 2), 'utf-8');
  }

  /** Add a notice. Returns the new notice id. */
  async add(title: string, body: string, severity: Notice['severity'] = 'info', source: string = 'system', actions?: NoticeAction[]): Promise<string> {
    if (!this.loaded) await this.load();
    const notice: Notice = {
      id: `ntc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      body,
      severity,
      source,
      createdAt: new Date().toISOString(),
      dismissed: false,
      ...(actions && actions.length > 0 ? { actions } : {}),
    };
    this.notices.push(notice);
    await this.save();
    this.emit('change');
    this.emit('added', notice);
    return notice.id;
  }

  /**
   * Upsert por source: descarta los notices activos previos de ese source y crea uno nuevo.
   * Para checks recurrentes (briefing, follow-up) que deben reemplazar, no apilar.
   */
  async replaceBySource(source: string, title: string, body: string, severity: Notice['severity'] = 'info', actions?: NoticeAction[]): Promise<string> {
    if (!this.loaded) await this.load();
    for (const n of this.notices) {
      if (n.source === source && !n.dismissed) n.dismissed = true;
    }
    return this.add(title, body, severity, source, actions);
  }

  /** Descarta todos los notices activos de un source (sin crear uno nuevo) */
  async clearSource(source: string): Promise<void> {
    if (!this.loaded) await this.load();
    let changed = false;
    for (const n of this.notices) {
      if (n.source === source && !n.dismissed) { n.dismissed = true; changed = true; }
    }
    if (changed) {
      await this.save();
      this.emit('change');
    }
  }

  /** Dismiss a notice */
  async dismiss(id: string): Promise<boolean> {
    if (!this.loaded) await this.load();
    const notice = this.notices.find(n => n.id === id);
    if (!notice) return false;
    notice.dismissed = true;
    await this.save();
    this.emit('change');
    return true;
  }

  /** Get all active (non-dismissed) notices */
  async getActive(): Promise<Notice[]> {
    if (!this.loaded) await this.load();
    return this.notices.filter(n => !n.dismissed);
  }

  /** Get all notices */
  async getAll(): Promise<Notice[]> {
    if (!this.loaded) await this.load();
    return [...this.notices];
  }

  /** Format active notices for display */
  async formatForDisplay(): Promise<string> {
    const active = await this.getActive();
    if (active.length === 0) return '';

    return active.map(n =>
      `[${n.severity.toUpperCase()}] ${n.title}: ${n.body} (id: ${n.id})`
    ).join('\n');
  }
}

// Singleton
let _instance: NoticeBoard | null = null;

export function getNoticeBoard(): NoticeBoard {
  if (!_instance) {
    _instance = new NoticeBoard();
  }
  return _instance;
}

export function resetNoticeBoard(): void {
  _instance = null;
}