import assert from 'node:assert/strict';
import { UsageService, getPlanAllowanceMetrics, type UsageCodexClient } from '../server/usage.js';
import type { CodexLocalUsage } from '../server/codex-local-usage.js';

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let clock = new Date('2026-07-13T12:00:00-05:00');
let todayTokens = 100;
let totalProcessedTokens = 12_345;
const fakeLocalUsage = async (): Promise<CodexLocalUsage> => ({
  totalRequests: 9,
  totalProcessedTokens,
  freshInputTokens: 1_000,
  cacheReadTokens: totalProcessedTokens - 1_500,
  outputTokens: 500,
  cacheHitRate: (totalProcessedTokens - 1_500) / (totalProcessedTokens - 500),
  tokensToday: todayTokens,
  tokensYesterday: 80,
  daily: [{ date: dateKey(clock), tokens: todayTokens }],
  todayHourlyTokens: [20, 80, todayTokens],
  recentRequestTokens: [1_800, 900, 2_400, 1_100],
  matrixDays: [],
  topModel: 'gpt-test',
});
const emptyLocalUsage = async (): Promise<CodexLocalUsage> => ({
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
});
const fakeCodex: UsageCodexClient = {
  async ensureStarted() {},
  async request(method: string) {
    if (method === 'account/rateLimits/read') {
      return {
        rateLimits: {
          limitId: 'codex',
          planType: 'plus',
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_784_000_000 },
          secondary: { usedPercent: 28, windowDurationMins: 10_080, resetsAt: 1_784_500_000 },
        },
      };
    }
    if (method === 'account/usage/read') {
      const yesterday = new Date(clock.getTime() - 86_400_000);
      return {
        summary: { lifetimeTokens: 12_345 },
        dailyUsageBuckets: [
          { startDate: dateKey(yesterday), tokens: 80 },
          { startDate: dateKey(clock), tokens: todayTokens },
        ],
      };
    }
    throw new Error(`Unexpected method ${method}`);
  },
};

const service = new UsageService(fakeCodex, () => new Date(clock), fakeLocalUsage);
let metrics = await service.refreshProvider('openai');
assert.equal(metrics.find(metric => metric.label === 'SESSION (5H)')?.value, '12%');
assert.equal(metrics.find(metric => metric.label === 'SESSION (5H)')?.subvalue, '88% AVAILABLE');
assert.equal(metrics.find(metric => metric.label === 'WEEK · CODEX')?.value, '28%');
assert.equal(metrics.find(metric => metric.label === 'ACCOUNT TIER')?.value, 'PLUS');
assert.equal(metrics.find(metric => metric.label === 'INSTANT CHAT')?.value, '160');
assert.equal(metrics.find(metric => metric.label === 'AGENT MODE')?.subvalue, 'REQUESTS / MO');
assert.equal(metrics.filter(metric => metric.group === 'plan_allowance').length, 6);
assert.equal(metrics.find(metric => metric.label === 'TOKENS TODAY')?.value, '100');
assert.deepEqual(metrics.find(metric => metric.label === 'TOKENS TODAY')?.sparkData, [20, 80, 100]);
assert.equal(metrics.find(metric => metric.label === 'TOKENS PROCESSED')?.value, '12.3K');
assert.deepEqual(metrics.find(metric => metric.label === 'TOKENS PROCESSED')?.sparkData, [1_800, 900, 2_400, 1_100]);
assert.equal(metrics.find(metric => metric.label === 'TOKENS PROCESSED')?.subvalue, '9 REQUESTS');
assert.equal(metrics.find(metric => metric.label === 'CREATION')?.value, 'N/A');
assert.equal(metrics.filter(metric => metric.group === 'token_breakdown').length, 5);
assert.equal(metrics.some(metric => metric.label === 'COST TODAY'), false);
assert.equal(metrics.some(metric => metric.label === 'BURN RATE'), false);
assert.equal(metrics.find(metric => metric.group === 'provider_selector')?.note, 'MODEL · GPT-TEST · PLUS');
assert.ok(metrics.findIndex(metric => metric.group === 'provider_selector') > metrics.findIndex(metric => metric.group === 'plan_allowance'));
assert.equal(metrics.at(-1)?.label, 'MODEL');

clock = new Date(clock.getTime() + 60_000);
todayTokens = 160;
totalProcessedTokens += 60;
metrics = await service.refreshProvider('openai');
assert.equal(metrics.some(metric => metric.label === 'BURN RATE'), false);
assert.deepEqual(service.getAllVitals().openai, metrics);

const noTokenCodex: UsageCodexClient = {
  ...fakeCodex,
  async request(method: string) {
    if (method === 'account/usage/read') {
      return { summary: { lifetimeTokens: 0 }, dailyUsageBuckets: [] };
    }
    return fakeCodex.request(method);
  },
};
const noTokenService = new UsageService(noTokenCodex, () => new Date(clock), emptyLocalUsage);
const noTokenMetrics = await noTokenService.refreshProvider('openai');
assert.equal(noTokenMetrics.some(metric => metric.label === 'TOKENS TODAY'), false);
assert.equal(noTokenMetrics.find(metric => metric.label === 'TOKEN TELEMETRY')?.value, 'N/A');
assert.equal(noTokenMetrics.find(metric => metric.label === 'TOKEN TELEMETRY')?.visual, 'none');
assert.equal(noTokenMetrics.some(metric => metric.label === 'BURN RATE'), false);
assert.equal(noTokenMetrics.at(-1)?.group, 'provider_selector');
assert.deepEqual(getPlanAllowanceMetrics('free'), []);
console.log('usage-vitals: ok');
