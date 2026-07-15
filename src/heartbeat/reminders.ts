import { promises as fs } from 'fs';
import * as path from 'path';
import { dataPath } from '../config/paths.js';

export interface Reminder {
  id: string;
  message: string;
  time: string; // ISO datetime when it should fire
  createdAt: string;
  fired: boolean;
}

function getFilePath(): string {
  return process.env.REMINDERS_FILE || dataPath('reminders.json');
}

export class ReminderStore {
  private reminders: Reminder[] = [];
  private loaded = false;

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(getFilePath(), 'utf-8');
      this.reminders = JSON.parse(data);
    } catch {
      this.reminders = [];
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(getFilePath()), { recursive: true });
    await fs.writeFile(getFilePath(), JSON.stringify(this.reminders, null, 2), 'utf-8');
  }

  async add(message: string, time: string): Promise<Reminder> {
    if (!this.loaded) await this.load();
    const reminder: Reminder = {
      id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      message,
      time,
      createdAt: new Date().toISOString(),
      fired: false,
    };
    this.reminders.push(reminder);
    await this.save();
    return reminder;
  }

  async getPending(): Promise<Reminder[]> {
    if (!this.loaded) await this.load();
    const now = new Date();
    return this.reminders.filter(r => !r.fired && new Date(r.time) <= now);
  }

  async markFired(id: string): Promise<boolean> {
    if (!this.loaded) await this.load();
    const r = this.reminders.find(r => r.id === id);
    if (!r) return false;
    r.fired = true;
    await this.save();
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    if (!this.loaded) await this.load();
    const idx = this.reminders.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.reminders.splice(idx, 1);
    await this.save();
    return true;
  }

  async getAll(): Promise<Reminder[]> {
    if (!this.loaded) await this.load();
    return [...this.reminders];
  }
}

let _instance: ReminderStore | null = null;

export function getReminderStore(): ReminderStore {
  if (!_instance) {
    _instance = new ReminderStore();
  }
  return _instance;
}

export function resetReminderStore(): void {
  _instance = null;
}