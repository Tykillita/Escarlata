import { ToolRegistry } from '../tools/registry.js';
import { Scheduler, getScheduler } from './scheduler.js';
import { NoticeBoard, getNoticeBoard } from './notices.js';
import { HeartbeatCheck, defaultChecks } from './checks.js';

export interface HeartbeatOptions {
  registry: ToolRegistry;
  checks?: HeartbeatCheck[];
  /** Milliseconds between heartbeat ticks (default: 30000 = 30s) */
  tickInterval?: number;
  /** Quiet hours start (0-23, default: 22 = 10pm) */
  quietStart?: number;
  /** Quiet hours end (0-23, default: 7 = 7am) */
  quietEnd?: number;
}

export class Heartbeat {
  private registry: ToolRegistry;
  private scheduler: Scheduler;
  private notices: NoticeBoard;
  private checks: Map<string, HeartbeatCheck> = new Map();
  private tickInterval: number;
  private quietStart: number;
  private quietEnd: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;
  private activeRuns = new Set<string>();

  constructor(options: HeartbeatOptions) {
    this.registry = options.registry;
    this.scheduler = getScheduler();
    this.notices = getNoticeBoard();
    this.tickInterval = options.tickInterval || 30000;
    this.quietStart = options.quietStart ?? parseInt(process.env.HEARTBEAT_QUIET_START || '23', 10);
    this.quietEnd = options.quietEnd ?? parseInt(process.env.HEARTBEAT_QUIET_END || '6', 10);

    const checkList = options.checks || defaultChecks;
    for (const check of checkList) {
      this.checks.set(check.id, check);
      this.scheduler.register(check.id, check.interval);
    }
  }

  async init(): Promise<void> {
    await this.scheduler.load();
    await this.notices.load();
    // 'startup' = una vez por arranque de proceso (load() lo trae deshabilitado del run anterior)
    for (const check of this.checks.values()) {
      if (check.interval === 'startup') this.scheduler.rearmStartup(check.id);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.timer = setInterval(() => this.tick(), this.tickInterval);
    // Run an immediate tick
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Pause all proactive behavior (kill switch) */
  pause(): void {
    this.paused = true;
  }

  /** Resume proactive behavior */
  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async tick(): Promise<void> {
    if (this.paused) return;

    const quiet = this.isQuietHours();
    const dueChecks = this.scheduler.getDueChecks();

    for (const scheduled of dueChecks) {
      const check = this.checks.get(scheduled.id);
      if (!check) {
        await this.scheduler.complete(scheduled.id);
        continue;
      }

      // Quiet hours: se difieren los checks normales (quedan due y corren al salir),
      // pero los marcados bypassQuietHours (recordatorios) pasan siempre
      if (quiet && !check.bypassQuietHours) continue;

      // Prevent overlapping runs
      if (this.activeRuns.has(scheduled.id)) continue;
      this.activeRuns.add(scheduled.id);

      try {
        await check.run(this.registry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[heartbeat] Check "${scheduled.id}" failed: ${msg}`);
      } finally {
        this.activeRuns.delete(scheduled.id);
        await this.scheduler.complete(scheduled.id);
      }
    }
  }

  private isQuietHours(): boolean {
    const hour = new Date().getHours();
    if (this.quietStart > this.quietEnd) {
      // Spans midnight (e.g., 22-7)
      return hour >= this.quietStart || hour < this.quietEnd;
    }
    return hour >= this.quietStart && hour < this.quietEnd;
  }

  async getActiveNotices(): Promise<string> {
    const text = await this.notices.formatForDisplay();
    return text || 'Sin avisos activos.';
  }

  async dismissNotice(id: string): Promise<string> {
    const ok = await this.notices.dismiss(id);
    return ok ? `✅ Aviso ${id} descartado` : `No encontré el aviso "${id}".`;
  }
}