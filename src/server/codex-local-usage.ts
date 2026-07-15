import { createReadStream, type Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export interface CodexUsageDay {
  date: string;
  tokens: number;
}

export interface CodexMatrixDay {
  date: string;
  messages: number;
  hourCounts: number[];
  sessionIds: string[];
  models: { model: string; provider: 'openai'; input: number; output: number; messages: number }[];
}

export interface CodexLocalUsage {
  totalRequests: number;
  totalProcessedTokens: number;
  freshInputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  cacheHitRate: number;
  tokensToday: number;
  tokensYesterday: number;
  daily: CodexUsageDay[];
  todayHourlyTokens: number[];
  recentRequestTokens: number[];
  matrixDays: CodexMatrixDay[];
  topModel?: string;
}

interface TokenEvent {
  key: string;
  sessionId: string;
  timestamp: number;
  input: number;
  cachedInput: number;
  output: number;
  model: string;
}

interface CachedFile {
  modifiedMs: number;
  size: number;
  events: TokenEvent[];
}

interface CumulativeTokens {
  input: number;
  cachedInput: number;
  output: number;
}

interface PendingEvent extends Omit<TokenEvent, 'key' | 'sessionId'> {
  eventIndex: number;
  lineOffset: number;
}

function finiteToken(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function parseTokenCounts(value: unknown): CumulativeTokens | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  return {
    input: finiteToken(usage.input_tokens),
    cachedInput: finiteToken(usage.cached_input_tokens ?? usage.cache_read_input_tokens),
    output: finiteToken(usage.output_tokens),
  };
}

function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyUsage(): CodexLocalUsage {
  return {
    totalRequests: 0,
    totalProcessedTokens: 0,
    freshInputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    cacheHitRate: 0,
    tokensToday: 0,
    tokensYesterday: 0,
    daily: [],
    todayHourlyTokens: [],
    recentRequestTokens: [],
    matrixDays: [],
  };
}

async function collectJsonlFiles(root: string, depth: number, maxDepth: number, output: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries.map(async entry => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory() && depth < maxDepth) {
      await collectJsonlFiles(entryPath, depth + 1, maxDepth, output);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      output.push(entryPath);
    }
  }));
}

async function parseSessionFile(filePath: string, fallbackTimestamp: number): Promise<TokenEvent[]> {
  const pending: PendingEvent[] = [];
  let threadId = path.basename(filePath, '.jsonl');
  let carriesHistorySnapshot = false;
  let replayBoundary: number | null = null;
  let currentModel = 'codex';
  let previousTotal: CumulativeTokens | null = null;
  let eventIndex = 0;
  let lineOffset = 0;

  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      lineOffset += 1;
      const relevant = line.includes('"token_count"')
        || line.includes('"session_meta"')
        || line.includes('"turn_context"')
        || line.includes('"thread_settings_applied"')
        || line.includes('"inter_agent_communication');
      if (!relevant) continue;

      let record: Record<string, any>;
      try {
        record = JSON.parse(line) as Record<string, any>;
      } catch {
        continue;
      }

      const type = typeof record.type === 'string' ? record.type : '';
      const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};

      if (type === 'session_meta') {
        const id = payload.id ?? payload.thread_id ?? payload.threadId ?? payload.session_id ?? payload.sessionId;
        if (typeof id === 'string' && id) threadId = id;
        const parentId = payload.session_id ?? payload.sessionId;
        carriesHistorySnapshot = Boolean(payload.forked_from_id)
          || Boolean(payload.source?.subagent)
          || (typeof parentId === 'string' && parentId.length > 0 && parentId !== threadId);
        continue;
      }

      if (type === 'turn_context') {
        const model = payload.model ?? payload.info?.model;
        if (typeof model === 'string' && model) currentModel = model;
        continue;
      }

      if (type.startsWith('inter_agent_communication')
        || (type === 'event_msg' && payload.type === 'thread_settings_applied')) {
        replayBoundary ??= lineOffset;
        continue;
      }

      if (type !== 'event_msg' || payload.type !== 'token_count' || !payload.info) continue;
      const info = payload.info as Record<string, any>;
      const model = info.model ?? info.model_name ?? payload.model;
      if (typeof model === 'string' && model) currentModel = model;

      const total = parseTokenCounts(info.total_token_usage);
      const last = total ? null : parseTokenCounts(info.last_token_usage);
      if (!total && !last) continue;

      let delta: CumulativeTokens;
      if (total) {
        delta = previousTotal ? {
          input: Math.max(0, total.input - previousTotal.input),
          cachedInput: Math.max(0, total.cachedInput - previousTotal.cachedInput),
          output: Math.max(0, total.output - previousTotal.output),
        } : total;
        previousTotal = total;
      } else {
        delta = last!;
      }

      delta.cachedInput = Math.min(delta.input, delta.cachedInput);
      if (delta.input === 0 && delta.cachedInput === 0 && delta.output === 0) continue;
      eventIndex += 1;

      const parsedTimestamp = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
      pending.push({
        eventIndex,
        lineOffset,
        timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : fallbackTimestamp,
        input: delta.input,
        cachedInput: delta.cachedInput,
        output: delta.output,
        model: currentModel,
      });
    }
  } finally {
    lines.close();
    input.destroy();
  }

  return pending
    .filter(event => !(carriesHistorySnapshot && replayBoundary !== null && event.lineOffset < replayBoundary))
    .map(({ eventIndex: index, lineOffset: _lineOffset, ...event }) => ({
      ...event,
      key: `${threadId}:${index}`,
      sessionId: threadId,
    }));
}

/**
 * Reads only Codex `token_count` records. Prompt text, tool arguments,
 * credentials and filesystem paths are never retained or returned.
 */
export class CodexLocalUsageScanner {
  private cache = new Map<string, CachedFile>();

  constructor(private codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {}

  async read(now = new Date()): Promise<CodexLocalUsage> {
    const files: string[] = [];
    await Promise.all([
      collectJsonlFiles(path.join(this.codexHome, 'sessions'), 0, 3, files),
      collectJsonlFiles(path.join(this.codexHome, 'archived_sessions'), 0, 1, files),
    ]);

    const liveFiles = new Set(files);
    for (const cachedPath of this.cache.keys()) {
      if (!liveFiles.has(cachedPath)) this.cache.delete(cachedPath);
    }

    await Promise.all(files.map(async filePath => {
      try {
        const stat = await fs.stat(filePath);
        const cached = this.cache.get(filePath);
        if (cached && cached.modifiedMs === stat.mtimeMs && cached.size === stat.size) return;
        const events = await parseSessionFile(filePath, stat.mtimeMs || now.getTime());
        this.cache.set(filePath, { modifiedMs: stat.mtimeMs, size: stat.size, events });
      } catch {
        this.cache.delete(filePath);
      }
    }));

    const unique = new Map<string, TokenEvent>();
    for (const file of this.cache.values()) {
      for (const event of file.events) unique.set(event.key, event);
    }
    if (unique.size === 0) return emptyUsage();

    const chronologicalEvents = [...unique.values()].sort((left, right) => left.timestamp - right.timestamp);
    const todayKey = localDate(now.getTime());
    const yesterdayKey = localDate(now.getTime() - 86_400_000);
    const todayHourlyTokens = Array.from({ length: now.getHours() + 1 }, () => 0);
    const daily = new Map<string, number>();
    const matrixByDay = new Map<string, {
      messages: number;
      hourCounts: number[];
      sessionIds: Set<string>;
      models: Map<string, { input: number; output: number; messages: number }>;
    }>();
    const modelTokens = new Map<string, number>();
    let freshInputTokens = 0;
    let cacheReadTokens = 0;
    let outputTokens = 0;

    for (const event of chronologicalEvents) {
      const fresh = Math.max(0, event.input - event.cachedInput);
      const processed = event.input + event.output;
      freshInputTokens += fresh;
      cacheReadTokens += event.cachedInput;
      outputTokens += event.output;
      const day = localDate(event.timestamp);
      daily.set(day, (daily.get(day) ?? 0) + processed);
      let matrixDay = matrixByDay.get(day);
      if (!matrixDay) {
        matrixDay = { messages: 0, hourCounts: new Array(24).fill(0), sessionIds: new Set(), models: new Map() };
        matrixByDay.set(day, matrixDay);
      }
      const hour = new Date(event.timestamp).getHours();
      matrixDay.messages += 1;
      matrixDay.hourCounts[hour] += 1;
      matrixDay.sessionIds.add(`openai:${event.sessionId}`);
      const modelUsage = matrixDay.models.get(event.model) ?? { input: 0, output: 0, messages: 0 };
      modelUsage.input += event.input;
      modelUsage.output += event.output;
      modelUsage.messages += 1;
      matrixDay.models.set(event.model, modelUsage);
      if (day === todayKey) {
        if (hour >= 0 && hour < todayHourlyTokens.length) todayHourlyTokens[hour] += processed;
      }
      modelTokens.set(event.model, (modelTokens.get(event.model) ?? 0) + processed);
    }

    const dailyValues = [...daily.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, tokens]) => ({ date, tokens }));
    const matrixDays = [...matrixByDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, day]) => ({
        date,
        messages: day.messages,
        hourCounts: day.hourCounts,
        sessionIds: [...day.sessionIds],
        models: [...day.models.entries()].map(([model, usage]) => ({ model, provider: 'openai' as const, ...usage })),
      }));
    const topModel = [...modelTokens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const cacheableInput = freshInputTokens + cacheReadTokens;

    return {
      totalRequests: unique.size,
      totalProcessedTokens: freshInputTokens + cacheReadTokens + outputTokens,
      freshInputTokens,
      cacheReadTokens,
      outputTokens,
      cacheHitRate: cacheableInput > 0 ? cacheReadTokens / cacheableInput : 0,
      tokensToday: daily.get(todayKey) ?? 0,
      tokensYesterday: daily.get(yesterdayKey) ?? 0,
      daily: dailyValues,
      todayHourlyTokens,
      recentRequestTokens: chronologicalEvents.slice(-20).map(event => event.input + event.output),
      matrixDays,
      topModel,
    };
  }
}

const defaultScanner = new CodexLocalUsageScanner();

export async function readCodexLocalUsage(now = new Date()): Promise<CodexLocalUsage> {
  return defaultScanner.read(now);
}
