import { promises as fs } from 'fs';
import * as path from 'path';

export interface CheckSchedule {
  id: string;
  /** cron-like interval: 'startup' | 'hourly' | 'daily' | 'weekly' | number (minutes) */
  interval: string | number;
  /** When this check last ran (ISO string) */
  lastRun: string | null;
  /** When this check is next due (ISO string) */
  nextRun: string;
  /** Whether this check is enabled */
  enabled: boolean;
}

function getSchedulePath(): string {
  return process.env.SCHEDULE_FILE || path.join(process.cwd(), 'data', 'schedule.json');
}

function parseNextRun(interval: string | number): Date {
  const now = new Date();
  if (typeof interval === 'number') {
    return new Date(now.getTime() + interval * 60000);
  }
  switch (interval) {
    case 'hourly':
      return new Date(now.getTime() + 60 * 60000);
    case 'daily': {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0); // Start at 8am
      return tomorrow;
    }
    case 'weekly': {
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + (7 - nextWeek.getDay() + 1) % 7 || 7);
      nextWeek.setHours(8, 0, 0, 0);
      return nextWeek;
    }
    default:
      return new Date(now.getTime() + 3600000); // fallback: 1 hour
  }
}

export class Scheduler {
  private checks: Map<string, CheckSchedule> = new Map();
  private loaded = false;

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(getSchedulePath(), 'utf-8');
      const parsed: CheckSchedule[] = JSON.parse(data);
      for (const c of parsed) {
        this.checks.set(c.id, c);
      }
    } catch {
      // No saved schedule yet
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(getSchedulePath()), { recursive: true });
    const data = JSON.stringify(Array.from(this.checks.values()), null, 2);
    await fs.writeFile(getSchedulePath(), data, 'utf-8');
  }

  register(id: string, interval: string | number): void {
    if (!this.checks.has(id)) {
      const now = new Date();
      this.checks.set(id, {
        id,
        interval,
        lastRun: null,
        nextRun: interval === 'startup'
          ? new Date(0).toISOString() // epoch = always due immediately
          : parseNextRun(interval).toISOString(),
        enabled: true,
      });
    }
  }

  /** Get checks that are due to run */
  getDueChecks(): CheckSchedule[] {
    const now = new Date();
    return Array.from(this.checks.values()).filter(c =>
      c.enabled && new Date(c.nextRun) <= now
    );
  }

  /** Mark a check as completed */
  async complete(id: string): Promise<void> {
    const check = this.checks.get(id);
    if (!check) return;
    check.lastRun = new Date().toISOString();
    if (check.interval === 'startup') {
      // Startup checks don't re-run
      check.enabled = false;
    } else {
      check.nextRun = parseNextRun(check.interval).toISOString();
    }
    await this.save();
  }

  /** Re-arma un check 'startup': debe correr en cada arranque de proceso,
      pero load() restaura el estado persistido (enabled:false tras la corrida anterior) */
  rearmStartup(id: string): void {
    const check = this.checks.get(id);
    if (!check || check.interval !== 'startup') return;
    check.enabled = true;
    check.nextRun = new Date(0).toISOString();
  }

  /** Enable or disable a check */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const check = this.checks.get(id);
    if (!check) return;
    check.enabled = enabled;
    await this.save();
  }

  getAll(): CheckSchedule[] {
    return Array.from(this.checks.values());
  }

  async reset(): Promise<void> {
    this.checks.clear();
    this.loaded = false;
    await this.save();
  }
}

// Singleton
let _instance: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (!_instance) {
    _instance = new Scheduler();
  }
  return _instance;
}

export function resetScheduler(): void {
  _instance = null;
}