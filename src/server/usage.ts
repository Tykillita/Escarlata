import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getCodexAppServer } from '../provider/codex-app-server.js';
import { readCodexLocalUsage, type CodexLocalUsage } from './codex-local-usage.js';

const execAsync = promisify(exec);

// Mirrors ui/src/types/index.ts VitalMetric — keep in sync manually.
export interface VitalMetric {
  label: string;
  value: string;
  trend?: 'up' | 'down';
  delta?: string;
  period?: string;
  note?: string;
  sparkData: number[];
  bar?: number; // 0-100; when set the UI renders a progress bar instead of the sparkline
  subvalue?: string;
  visual?: 'spark' | 'none';
  group?: 'plan_allowance' | 'token_breakdown' | 'provider_selector';
}

export type VitalsProvider = 'anthropic' | 'openai';
export type VitalsByProvider = Record<VitalsProvider, VitalMetric[] | null>;

export interface UsageCodexClient {
  ensureStarted(): Promise<void>;
  request(method: string, params?: Record<string, unknown>): Promise<any>;
}

export type CodexUsageReader = (now?: Date) => Promise<CodexLocalUsage>;

interface PlanLimit {
  kind: string;
  percent: number;
  resets_at: string;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

interface CcusageBlock {
  isActive: boolean;
  isGap: boolean;
  startTime: string;
  endTime: string;
  totalTokens: number;
  costUSD: number;
  models: string[];
  tokenCounts?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  burnRate: number | { tokensPerMinute?: number; tokensPerMinuteForIndicator?: number } | null;
}

interface CcusageDaily {
  period: string; // YYYY-MM-DD
  totalTokens: number;
  totalCost: number;
}

interface CodexRateWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

interface CodexRateLimit {
  limitId: string | null;
  limitName: string | null;
  primary: CodexRateWindow | null;
  secondary: CodexRateWindow | null;
  planType: string | null;
}

interface CodexUsageBucket {
  startDate: string;
  tokens: number;
}

const CCUSAGE_TIMEOUT = 120_000;
const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CREDENTIALS_FILE = path.join(os.homedir(), '.claude', '.credentials.json');
const SPARK_BUFFER_MAX = 20;
// The oauth usage endpoint rate-limits aggressively (Claude Code polls it too),
// so query it far less often than the ccusage refresh and back off on 429.
const PLAN_LIMITS_INTERVAL = 5 * 60_000;
const PLAN_LIMITS_BACKOFF = 15 * 60_000;
// An expired token recovers as soon as Claude Code refreshes its credentials,
// so failed fetches retry fast and a credentials-file change bypasses the wait.
const PLAN_LIMITS_RETRY = 60_000;
const PLAN_CACHE_FILE = path.join(process.env.ESCARLATA_DATA_DIR || path.resolve('data'), 'plan-vitals.json');

function formatK(n: number): string {
  if (!isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatReset(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'RESET UNKNOWN';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${h}:${String(d.getMinutes()).padStart(2, '0')}${ampm}`;
  if (localDateStr(d) === localDateStr(new Date())) return `RESETS ${time}`;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `RESETS ${months[d.getMonth()]} ${d.getDate()} · ${time}`;
}

function rateWindowLabel(window: CodexRateWindow, fallback: string): string {
  const minutes = window.windowDurationMins;
  if (minutes === 300) return 'SESSION (5H)';
  if (minutes === 10_080) return 'WEEK · CODEX';
  if (minutes && minutes % 1_440 === 0) return `${minutes / 1_440} DAY LIMIT`;
  if (minutes && minutes % 60 === 0) return `${minutes / 60} HOUR LIMIT`;
  return fallback;
}

// Public ChatGPT Plus plan caps. These are entitlements, not live remaining
// balances: ChatGPT does not expose those consumer counters through app-server.
// Sources: OpenAI Help Center articles for GPT models, Agent, Files, Library,
// Deep Research and Voice. Keep the UI explicitly labelled "NOT LIVE".
export function getPlanAllowanceMetrics(planType: string): VitalMetric[] {
  if (planType.toLowerCase() !== 'plus') return [];
  const allowance = (label: string, value: string, subvalue: string): VitalMetric => ({
    label,
    value,
    subvalue,
    visual: 'none',
    group: 'plan_allowance',
    sparkData: [],
  });
  return [
    allowance('INSTANT CHAT', '160', 'MSG / 3H'),
    allowance('AGENT MODE', '40', 'REQUESTS / MO'),
    allowance('FILE UPLOADS', '80', 'FILES / 3H'),
    allowance('LIBRARY', '20GB', 'STORAGE'),
    allowance('DEEP RESEARCH', '30D', 'RESET CYCLE'),
    allowance('VOICE', '1D', 'VARIABLE CAP'),
  ];
}

// Sparkline component divides by data.length - 1, so always give it >= 2 points.
function padSpark(data: number[]): number[] {
  if (data.length === 0) return [0, 0];
  if (data.length === 1) return [data[0], data[0]];
  return data;
}

export class UsageService {
  private vitalsByProvider: VitalsByProvider = { anthropic: null, openai: null };
  private planMetrics: VitalMetric[] = [];
  private burnSpark: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private planNextFetchAt = 0;
  private planCacheLoaded = false;
  private planLastFetchFailed = false;
  private credentialsMtimeAtLastFetch = 0;

  constructor(
    private codexClient: UsageCodexClient = getCodexAppServer(),
    private now: () => Date = () => new Date(),
    private codexUsageReader: CodexUsageReader = readCodexLocalUsage,
  ) {}

  getVitals(provider: VitalsProvider = 'anthropic'): VitalMetric[] | null {
    return this.vitalsByProvider[provider];
  }

  getAllVitals(): VitalsByProvider {
    return {
      anthropic: this.vitalsByProvider.anthropic,
      openai: this.vitalsByProvider.openai,
    };
  }

  start(intervalMs: number, onUpdate: (provider: VitalsProvider, metrics: VitalMetric[]) => void): void {
    const tick = async () => {
      await Promise.all((['anthropic', 'openai'] as const).map(async provider => {
        try {
          const metrics = await this.refreshProvider(provider);
          onUpdate(provider, metrics);
        } catch (err) {
          console.warn(`[usage:${provider}] refresh failed:`, err instanceof Error ? err.message : err);
        }
      }));
    };
    void tick();
    this.timer = setInterval(tick, intervalMs);
  }

  async refreshProvider(provider: VitalsProvider): Promise<VitalMetric[]> {
    if (provider === 'openai') await this.refreshOpenAI();
    else await this.refreshAnthropic();
    return this.vitalsByProvider[provider] ?? [];
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runCcusage(args: string): Promise<unknown> {
    const { stdout } = await execAsync(`npx --yes ccusage@latest ${args} --json`, {
      timeout: CCUSAGE_TIMEOUT,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    return JSON.parse(stdout);
  }

  // Official plan limits (session %, weekly %) from the same endpoint Claude Code's
  // /usage screen uses, authenticated with the local Claude Code OAuth token.
  private async fetchPlanLimits(): Promise<VitalMetric[] | null> {
    try {
      const raw = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
      const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
      if (!token) return null;
      const ac = new AbortController();
      const abortTimer = setTimeout(() => ac.abort(), 15_000);
      let res: Response;
      try {
        res = await fetch(OAUTH_USAGE_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
          },
          signal: ac.signal,
        });
      } finally {
        clearTimeout(abortTimer);
      }
      if (!res.ok) {
        console.warn(`[usage] oauth usage endpoint returned ${res.status}`);
        if (res.status === 429) {
          this.planNextFetchAt = Date.now() + PLAN_LIMITS_BACKOFF;
        }
        return null;
      }
      const data = await res.json() as { limits?: PlanLimit[] };
      const limits = data.limits ?? [];
      const metrics: VitalMetric[] = [];
      for (const limit of limits) {
        let label: string;
        if (limit.kind === 'session') label = 'SESSION (5H)';
        else if (limit.kind === 'weekly_all') label = 'WEEK · ALL MODELS';
        else if (limit.kind === 'weekly_scoped') {
          const model = limit.scope?.model?.display_name;
          label = `WEEK · ${(model || 'SCOPED').toUpperCase()}`;
        } else continue;
        metrics.push({
          label,
          value: `${Math.round(limit.percent)}%`,
          note: formatReset(limit.resets_at),
          bar: Math.min(100, Math.max(0, limit.percent)),
          sparkData: [],
        });
      }
      return metrics.length > 0 ? metrics : null;
    } catch (err) {
      console.warn('[usage] plan limits fetch failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  // Survive server restarts: reuse the last good plan metrics from disk while
  // the oauth endpoint is unavailable (e.g. rate-limited with 429).
  private async loadPlanCache(): Promise<void> {
    this.planCacheLoaded = true;
    try {
      const raw = await fs.readFile(PLAN_CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw) as { metrics?: VitalMetric[] };
      if (Array.isArray(data.metrics) && data.metrics.length > 0) {
        this.planMetrics = data.metrics;
      }
    } catch { /* no cache yet */ }
  }

  private async savePlanCache(metrics: VitalMetric[]): Promise<void> {
    try {
      await fs.mkdir(path.dirname(PLAN_CACHE_FILE), { recursive: true });
      await fs.writeFile(PLAN_CACHE_FILE, JSON.stringify({ metrics, fetchedAt: new Date().toISOString() }, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[usage] plan cache write failed:', err instanceof Error ? err.message : err);
    }
  }

  private async credentialsMtime(): Promise<number> {
    try { return (await fs.stat(CREDENTIALS_FILE)).mtimeMs; } catch { return 0; }
  }

  private async refreshPlanLimits(): Promise<void> {
    if (!this.planCacheLoaded) await this.loadPlanCache();
    const mtime = await this.credentialsMtime();
    // A rewritten credentials file means Claude Code refreshed the token: retry right away.
    const tokenRenewed = this.planLastFetchFailed && mtime > this.credentialsMtimeAtLastFetch;
    if (Date.now() < this.planNextFetchAt && !tokenRenewed) return;
    const plannedNext = Date.now() + PLAN_LIMITS_INTERVAL;
    this.planNextFetchAt = plannedNext;
    this.credentialsMtimeAtLastFetch = mtime;
    const metrics = await this.fetchPlanLimits(); // may push planNextFetchAt further on 429
    this.planLastFetchFailed = !metrics;
    if (metrics) {
      this.planMetrics = metrics;
      await this.savePlanCache(metrics);
    } else if (this.planNextFetchAt <= plannedNext) {
      // Fast retry on auth failures; a 429 already pushed planNextFetchAt beyond the interval.
      this.planNextFetchAt = Date.now() + PLAN_LIMITS_RETRY;
    }
  }

  private async refreshAnthropic(): Promise<void> {
    const [blocksRaw, dailyRaw] = await Promise.all([
      this.runCcusage('blocks'),
      this.runCcusage('daily'),
      this.refreshPlanLimits(),
    ]);

    const blocks = ((blocksRaw as { blocks?: CcusageBlock[] })?.blocks ?? []);
    const daily = ((dailyRaw as { daily?: CcusageDaily[] })?.daily ?? []);

    const active = blocks.find(b => b.isActive && !b.isGap) ?? null;

    // TOKENS TODAY & COST TODAY — from daily report, delta vs yesterday
    const today = localDateStr(new Date());
    const yesterday = localDateStr(new Date(Date.now() - 86_400_000));
    const todayEntry = daily.find(d => d.period === today);
    const yesterdayEntry = daily.find(d => d.period === yesterday);
    const tokensToday = todayEntry?.totalTokens ?? 0;
    const tokensYesterday = yesterdayEntry?.totalTokens ?? 0;
    const costToday = todayEntry?.totalCost ?? 0;
    const costYesterday = yesterdayEntry?.totalCost ?? 0;
    const recent = daily.slice(-14);

    // BURN RATE — tokens/min of the active block
    const rawBurn = active?.burnRate;
    // tokensPerMinute counts cache reads and inflates wildly; the indicator variant doesn't.
    const tpm = typeof rawBurn === 'number' ? rawBurn : rawBurn?.tokensPerMinuteForIndicator ?? rawBurn?.tokensPerMinute ?? 0;
    this.burnSpark = [...this.burnSpark, tpm].slice(-SPARK_BUFFER_MAX);
    const topModel = active?.models?.[0]?.replace(/^claude-/, '').toUpperCase();

    this.vitalsByProvider.anthropic = [
      ...this.planMetrics,
      {
        label: 'TOKENS TODAY',
        value: formatK(tokensToday),
        trend: tokensToday >= tokensYesterday ? 'up' : 'down',
        delta: formatK(Math.abs(tokensToday - tokensYesterday)),
        period: 'vs yday',
        sparkData: padSpark(recent.map(d => d.totalTokens)),
      },
      {
        label: 'COST TODAY',
        value: `$${costToday.toFixed(2)}`,
        trend: costToday >= costYesterday ? 'up' : 'down',
        delta: `$${Math.abs(costToday - costYesterday).toFixed(2)}`,
        period: 'vs yday',
        sparkData: padSpark(recent.map(d => d.totalCost)),
      },
      {
        label: 'BURN RATE',
        value: formatK(tpm),
        trend: 'up',
        delta: formatK(tpm),
        period: 'tok/min',
        note: topModel ? `MODEL · ${topModel}` : 'IDLE',
        sparkData: padSpark(this.burnSpark),
      },
    ];
  }

  private async refreshOpenAI(): Promise<void> {
    const client = this.codexClient;
    await client.ensureStarted();
    const currentTime = this.now();
    const [limitsRaw, usageRaw, localUsage] = await Promise.all([
      client.request('account/rateLimits/read'),
      client.request('account/usage/read'),
      this.codexUsageReader(currentTime),
    ]);

    const limitsResult = limitsRaw as {
      rateLimits?: CodexRateLimit;
      rateLimitsByLimitId?: Record<string, CodexRateLimit | undefined> | null;
    };
    const limitMap = limitsResult.rateLimitsByLimitId
      ? Object.values(limitsResult.rateLimitsByLimitId).filter((limit): limit is CodexRateLimit => Boolean(limit))
      : [];
    const limits = limitMap.length ? limitMap : limitsResult.rateLimits ? [limitsResult.rateLimits] : [];
    const rateMetrics: VitalMetric[] = [];
    let planType = 'CHATGPT';

    for (const limit of limits) {
      planType = limit.planType?.toUpperCase() || planType;
      for (const [index, window] of [limit.primary, limit.secondary].entries()) {
        if (!window) continue;
        const resetIso = window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : '';
        rateMetrics.push({
          label: rateWindowLabel(window, `${(limit.limitName || limit.limitId || 'CODEX').toUpperCase()} LIMIT ${index + 1}`),
          value: `${Math.round(window.usedPercent)}%`,
          note: resetIso ? formatReset(resetIso) : 'RESET UNKNOWN',
          bar: Math.min(100, Math.max(0, window.usedPercent)),
          subvalue: `${Math.max(0, Math.round(100 - window.usedPercent))}% AVAILABLE`,
          sparkData: [],
        });
      }
    }

    const usage = usageRaw as {
      summary?: { lifetimeTokens?: number | null };
      dailyUsageBuckets?: CodexUsageBucket[] | null;
    };
    const daily = usage.dailyUsageBuckets ?? [];
    const today = localDateStr(currentTime);
    const yesterday = localDateStr(new Date(currentTime.getTime() - 86_400_000));
    const hasLocalTelemetry = localUsage.totalRequests > 0;
    const tokensToday = hasLocalTelemetry
      ? localUsage.tokensToday
      : Number(daily.find(bucket => bucket.startDate === today)?.tokens ?? 0);
    const tokensYesterday = hasLocalTelemetry
      ? localUsage.tokensYesterday
      : Number(daily.find(bucket => bucket.startDate === yesterday)?.tokens ?? 0);
    const lifetimeTokens = hasLocalTelemetry
      ? localUsage.totalProcessedTokens
      : Number(usage.summary?.lifetimeTokens ?? 0);
    const recent = hasLocalTelemetry
      ? localUsage.daily.slice(-14).map(bucket => bucket.tokens)
      : daily.slice(-14).map(bucket => Number(bucket.tokens));
    const todaySpark = hasLocalTelemetry ? localUsage.todayHourlyTokens : recent;
    const processedSpark = hasLocalTelemetry ? localUsage.recentRequestTokens : recent;

    const hasTokenTelemetry = hasLocalTelemetry || daily.length > 0 || lifetimeTokens > 0;
    const tokenMetrics: VitalMetric[] = hasLocalTelemetry ? [
      {
        label: 'TOKENS TODAY',
        value: formatK(tokensToday),
        trend: tokensToday >= tokensYesterday ? 'up' : 'down',
        delta: formatK(Math.abs(tokensToday - tokensYesterday)),
        period: 'vs yday',
        sparkData: padSpark(todaySpark),
      },
      {
        label: 'TOKENS PROCESSED',
        value: formatK(lifetimeTokens),
        subvalue: `${localUsage.totalRequests.toLocaleString()} REQUESTS`,
        note: `${localUsage.totalProcessedTokens.toLocaleString('en-US')} EXACT TOKENS`,
        sparkData: padSpark(processedSpark),
      },
      {
        label: 'FRESH INPUT',
        value: formatK(localUsage.freshInputTokens),
        visual: 'none',
        group: 'token_breakdown',
        sparkData: [],
      },
      {
        label: 'CACHE HIT',
        value: formatK(localUsage.cacheReadTokens),
        visual: 'none',
        group: 'token_breakdown',
        sparkData: [],
      },
      {
        label: 'OUTPUT',
        value: formatK(localUsage.outputTokens),
        visual: 'none',
        group: 'token_breakdown',
        sparkData: [],
      },
      {
        label: 'CREATION',
        value: 'N/A',
        subvalue: 'NOT REPORTED',
        visual: 'none',
        group: 'token_breakdown',
        sparkData: [],
      },
      {
        label: 'CACHE HIT RATE',
        value: `${(localUsage.cacheHitRate * 100).toFixed(1)}%`,
        bar: localUsage.cacheHitRate * 100,
        group: 'token_breakdown',
        sparkData: [],
      },
    ] : hasTokenTelemetry ? [
      {
        label: 'TOKENS TODAY',
        value: formatK(tokensToday),
        trend: tokensToday >= tokensYesterday ? 'up' : 'down',
        delta: formatK(Math.abs(tokensToday - tokensYesterday)),
        period: 'vs yday',
        sparkData: padSpark(recent),
      },
      {
        label: 'TOKENS PROCESSED',
        value: formatK(lifetimeTokens),
        note: 'REPORTED BY CODEX APP-SERVER',
        sparkData: padSpark(recent),
      },
    ] : [
      {
        label: 'TOKEN TELEMETRY',
        value: 'N/A',
        subvalue: 'NO LOCAL SESSIONS',
        note: 'CODEX LIMIT DATA REMAINS LIVE',
        visual: 'none',
        sparkData: [],
      },
    ];

    this.vitalsByProvider.openai = [
      ...rateMetrics,
      {
        label: 'ACCOUNT TIER',
        value: planType,
        subvalue: 'CHATGPT SUBSCRIPTION',
        visual: 'none',
        sparkData: [],
      },
      ...tokenMetrics,
      ...getPlanAllowanceMetrics(planType),
      {
        label: 'MODEL',
        value: localUsage.topModel || 'CODEX',
        note: `MODEL · ${(localUsage.topModel || 'CODEX').toUpperCase()} · ${planType}`,
        visual: 'none',
        group: 'provider_selector',
        sparkData: [],
      },
    ];
  }
}
