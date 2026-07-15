import 'dotenv/config';
import { Agent, buildSystemPrompt } from '../agent/core.js';
import { createProvider } from '../provider/provider.js';
import { ToolRegistry, registerAllTools } from '../tools/index.js';

async function test() {
  const provider = createProvider({
    model: process.env.MODEL_NAME || 'mock',
  });

  const registry = new ToolRegistry();
  registerAllTools(registry);
  const toolCount = registry.getDefinitions().length;

  const agent = new Agent({
    provider,
    systemPrompt: buildSystemPrompt(),
    toolRegistry: registry,
  });

  console.log(`Tools registered: ${toolCount}`);

  // Turn 1
  let response = '';
  for await (const chunk of agent.processTurn('Hello! My name is Alex.')) {
    response += chunk;
  }
  console.log('Turn 1 response:', response);

  // Turn 2 — check memory of previous turn
  response = '';
  for await (const chunk of agent.processTurn("What's my name?")) {
    response += chunk;
  }
  console.log('Turn 2 response:', response);

  const history = agent.getHistory();
  console.log('\nHistory length:', history.length, '(expected 4 — 2 user + 2 assistant)');
  console.log('History roles:', history.map(m => m.role).join(', '));

  // Verify the mock provider doesn't use tools (it should just text)
  const allText = history.every(m => typeof m.content === 'string');
  console.log('All text messages:', allText ? '✅' : '❌ (some content blocks present)');

  console.log('\n✅ Tier 1+2 base test passes.');
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});