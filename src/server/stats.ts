import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readCodexLocalUsage, type CodexMatrixDay } from './codex-local-usage.js';

// Mirrors ui/src/types/index.ts UsageStatsDay — keep in sync manually.
export interface UsageStatsDay {
  date: string; // YYYY-MM-DD local
  messages: number;
  hourCounts: number[]; // 24 buckets
  sessionIds: string[];
  models: { model: string; provider: 'anthropic' | 'openai'; input: number; output: number; messages: number }[];
}

const PROJECTS_DIR = path.join(process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude'), 'projects');

interface TranscriptEntry {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
  message?: {
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DayAgg {
  messages: number;
  hourCounts: number[];
  sessionIds: Set<string>;
  models: Map<string, { model: string; provider: 'anthropic' | 'openai'; input: number; output: number; messages: number }>;
}

export function mergeUsageStatsDays(...sources: UsageStatsDay[][]): UsageStatsDay[] {
  const byDay = new Map<string, DayAgg>();
  for (const days of sources) {
    for (const day of days) {
      let aggregate = byDay.get(day.date);
      if (!aggregate) {
        aggregate = { messages: 0, hourCounts: new Array(24).fill(0), sessionIds: new Set(), models: new Map() };
        byDay.set(day.date, aggregate);
      }
      aggregate.messages += day.messages;
      day.hourCounts.forEach((count, hour) => { aggregate!.hourCounts[hour] += count; });
      day.sessionIds.forEach(sessionId => aggregate!.sessionIds.add(sessionId));
      for (const model of day.models) {
        const key = `${model.provider}:${model.model}`;
        const current = aggregate.models.get(key) ?? {
          model: model.model,
          provider: model.provider,
          input: 0,
          output: 0,
          messages: 0,
        };
        current.input += model.input;
        current.output += model.output;
        current.messages += model.messages;
        aggregate.models.set(key, current);
      }
    }
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => ({
      date,
      messages: day.messages,
      hourCounts: day.hourCounts,
      sessionIds: [...day.sessionIds],
      models: [...day.models.values()],
    }));
}

export class UsageStatsService {
  private days: UsageStatsDay[] = [];
  private timer: NodeJS.Timeout | null = null;

  getDays(): UsageStatsDay[] {
    return this.days;
  }

  start(intervalMs: number, onUpdate: (days: UsageStatsDay[]) => void): void {
    const tick = async () => {
      try {
        await this.refresh();
        onUpdate(this.days);
      } catch (err) {
        console.warn('[stats] refresh failed:', err instanceof Error ? err.message : err);
      }
    };
    void tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async listTranscripts(): Promise<string[]> {
    const results: string[] = [];
    async function scan(dir: string) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(full);
        else if (entry.name.endsWith('.jsonl')) results.push(full);
      }
    }
    await scan(PROJECTS_DIR);
    return results;
  }

  /** Refresh on demand for the desktop shell, without waiting for a server timer. */
  async refresh(): Promise<UsageStatsDay[]> {
    const files = await this.listTranscripts();
    const byDay = new Map<string, DayAgg>();

    for (const file of files) {
      let content: string;
      try {
        content = await fs.readFile(file, 'utf-8');
      } catch {
        continue;
      }
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let entry: TranscriptEntry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.type !== 'user' && entry.type !== 'assistant') continue;
        if (entry.isSidechain || entry.isApiErrorMessage || !entry.timestamp) continue;

        const ts = new Date(entry.timestamp);
        if (isNaN(ts.getTime())) continue;
        const date = localDateStr(ts);
        let agg = byDay.get(date);
        if (!agg) {
          agg = { messages: 0, hourCounts: new Array(24).fill(0), sessionIds: new Set(), models: new Map() };
          byDay.set(date, agg);
        }

        agg.messages++;
        agg.hourCounts[ts.getHours()]++;
        if (entry.sessionId) agg.sessionIds.add(entry.sessionId);

        if (entry.type === 'assistant') {
          const model = entry.message?.model;
          if (model && model !== '<synthetic>') {
            const key = `anthropic:${model}`;
            let m = agg.models.get(key);
            if (!m) {
              m = { model, provider: 'anthropic', input: 0, output: 0, messages: 0 };
              agg.models.set(key, m);
            }
            m.input += entry.message?.usage?.input_tokens ?? 0;
            m.output += entry.message?.usage?.output_tokens ?? 0;
            m.messages++;
          }
        }
      }
    }

    const claudeDays: UsageStatsDay[] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, agg]) => ({
        date,
        messages: agg.messages,
        hourCounts: agg.hourCounts,
        sessionIds: [...agg.sessionIds].map(sessionId => `anthropic:${sessionId}`),
        models: [...agg.models.values()],
      }));
    const codex = await readCodexLocalUsage();
    this.days = mergeUsageStatsDays(claudeDays, codex.matrixDays as CodexMatrixDay[]);
    return this.days;
  }
}
