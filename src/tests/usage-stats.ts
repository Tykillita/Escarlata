import assert from 'node:assert/strict';
import { mergeUsageStatsDays, type UsageStatsDay } from '../server/stats.js';

const claude: UsageStatsDay[] = [{
  date: '2026-07-14',
  messages: 4,
  hourCounts: [0, 2, 2, ...new Array(21).fill(0)],
  sessionIds: ['anthropic:session-a'],
  models: [{ model: 'claude-test', provider: 'anthropic', input: 100, output: 20, messages: 2 }],
}];
const chatgpt: UsageStatsDay[] = [{
  date: '2026-07-14',
  messages: 3,
  hourCounts: [0, 1, 0, 2, ...new Array(20).fill(0)],
  sessionIds: ['openai:session-b'],
  models: [{ model: 'gpt-test', provider: 'openai', input: 300, output: 40, messages: 3 }],
}];

const [merged] = mergeUsageStatsDays(claude, chatgpt);
assert.equal(merged.messages, 7);
assert.equal(merged.hourCounts[1], 3);
assert.equal(merged.hourCounts[3], 2);
assert.deepEqual(new Set(merged.sessionIds), new Set(['anthropic:session-a', 'openai:session-b']));
assert.equal(merged.models.length, 2);
assert.equal(merged.models.find(model => model.provider === 'openai')?.input, 300);
assert.equal(merged.models.find(model => model.provider === 'anthropic')?.output, 20);

console.log('usage-stats: ok');
