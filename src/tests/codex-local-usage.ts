import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexLocalUsageScanner } from '../server/codex-local-usage.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'escarlata-codex-usage-'));
const sessions = path.join(root, 'sessions', '2026', '07', '13');
const archived = path.join(root, 'archived_sessions');
await fs.mkdir(sessions, { recursive: true });
await fs.mkdir(archived, { recursive: true });

const line = (timestamp: string, type: string, payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp, type, payload });
const token = (timestamp: string, input: number, cached: number, output: number) => line(timestamp, 'event_msg', {
  type: 'token_count',
  info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } },
});

const primary = [
  line('2026-07-13T12:00:00Z', 'session_meta', { id: 'thread-a', session_id: 'thread-a' }),
  line('2026-07-13T12:00:00Z', 'turn_context', { model: 'gpt-test' }),
  token('2026-07-13T12:01:00Z', 100, 80, 10),
  token('2026-07-13T12:02:00Z', 150, 100, 20),
  // Must never be parsed or retained by the usage scanner.
  line('2026-07-13T12:03:00Z', 'response_item', { text: 'private conversation content' }),
].join('\n');
await fs.writeFile(path.join(sessions, 'primary.jsonl'), primary);
// Archived duplicates are deduplicated by thread + event index.
await fs.writeFile(path.join(archived, 'primary-copy.jsonl'), primary);

await fs.writeFile(path.join(sessions, 'subagent.jsonl'), [
  line('2026-07-13T12:00:00Z', 'session_meta', { id: 'child', session_id: 'parent', source: { subagent: {} } }),
  token('2026-07-13T12:01:00Z', 150, 100, 20),
  line('2026-07-13T12:02:00Z', 'event_msg', { type: 'thread_settings_applied' }),
  token('2026-07-13T12:03:00Z', 200, 140, 30),
].join('\n'));

await fs.writeFile(path.join(sessions, 'yesterday.jsonl'), [
  line('2026-07-12T12:00:00Z', 'session_meta', { id: 'thread-old', session_id: 'thread-old' }),
  token('2026-07-12T12:01:00Z', 20, 0, 5),
].join('\n'));

try {
  const scanner = new CodexLocalUsageScanner(root);
  const usage = await scanner.read(new Date('2026-07-13T18:00:00Z'));
  assert.equal(usage.totalRequests, 4);
  assert.equal(usage.freshInputTokens, 80);
  assert.equal(usage.cacheReadTokens, 140);
  assert.equal(usage.outputTokens, 35);
  assert.equal(usage.totalProcessedTokens, 255);
  assert.equal(usage.tokensToday, 230);
  assert.equal(usage.tokensYesterday, 25);
  assert.equal(usage.topModel, 'gpt-test');
  assert.equal(usage.todayHourlyTokens.reduce((sum, tokens) => sum + tokens, 0), 230);
  assert.deepEqual(usage.recentRequestTokens, [25, 110, 60, 60]);
  assert.equal(usage.matrixDays.reduce((sum, day) => sum + day.messages, 0), 4);
  assert.equal(usage.matrixDays.flatMap(day => day.models).every(model => model.provider === 'openai'), true);
  assert.ok(Math.abs(usage.cacheHitRate - (140 / 220)) < 0.000001);

  // A second read uses the metadata cache and must remain stable.
  assert.deepEqual(await scanner.read(new Date('2026-07-13T18:01:00Z')), usage);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('codex-local-usage: ok');
