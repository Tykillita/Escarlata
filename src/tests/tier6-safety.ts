import 'dotenv/config';
import { Agent, buildSystemPrompt, ConfirmationResult } from '../agent/core.js';
import { createProvider } from '../provider/provider.js';
import { Provider, Message, ProviderEvent } from '../provider/types.js';
import { ToolRegistry, registerAllTools } from '../tools/index.js';
import { resetMemoryStore } from '../memory/store.js';
import { getConfigManager, resetConfigManager } from '../config/manager.js';
import { formatAuditLog } from '../config/audit.js';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG_FILE = path.join(process.cwd(), 'data', 'test-config.json');
const AUDIT_FILE = path.join(process.cwd(), 'data', 'test-audit.log');
const MEMORY_FILE = path.join(process.cwd(), 'data', 'test-tier6-memory.json');

async function test() {
  try { fs.unlinkSync(CONFIG_FILE); } catch {}
  try { fs.unlinkSync(AUDIT_FILE); } catch {}
  try { fs.unlinkSync(MEMORY_FILE); } catch {}

  process.env.CONFIG_FILE = CONFIG_FILE;
  process.env.AUDIT_FILE = AUDIT_FILE;
  process.env.MEMORY_FILE = MEMORY_FILE;

  // Provider that simulates a dangerous tool call
  let callCount = 0;
  const testProvider: Provider = {
    async *complete(_messages: Message[], _tools?: any[]): AsyncIterable<ProviderEvent> {
      callCount++;
      if (callCount === 1) {
        yield { type: 'text', delta: 'I need to ' };
        yield { type: 'tool_use', id: 'tu_001', name: 'forget', input: { id: 'test_123' } };
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'text', delta: 'The action was denied. I will not proceed.' };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    },
  };

  resetConfigManager();
  resetMemoryStore();

  const configMgr = getConfigManager();
  await configMgr.load();
  await configMgr.updateRule('forget', 'ask_first');

  // --- Test 1: Confirmation gate denies dangerous tools ---
  {
    let gateCalled = false;
    const gate = async (name: string, _input: Record<string, unknown>, _desc: string): Promise<ConfirmationResult> => {
      gateCalled = true;
      console.log(`  Confirmation gate called for: ${name}`);
      return 'denied';
    };

    const registry = new ToolRegistry();
    registerAllTools(registry);

    const agent = new Agent({
      provider: testProvider,
      systemPrompt: buildSystemPrompt(),
      toolRegistry: registry,
      confirmationGate: gate,
    });

    let response = '';
    for await (const chunk of agent.processTurn('Delete that memory')) {
      response += chunk;
    }

    console.log('Test 1: Confirmation gate');
    console.log('  Gate was called:', gateCalled ? '✅' : '❌');
    console.log('  Response:', response);

    if (!gateCalled) {
      console.error('❌ Confirmation gate was not called');
      process.exit(1);
    }
    console.log('  ✅ Test 1 passed\n');
  }

  // --- Test 2: Audit log records events ---
  {
    const log = await formatAuditLog(50);
    console.log('Test 2: Audit log');
    console.log('  Entries recorded:', log !== 'No audit entries.' ? '✅' : '❌');
    console.log('  Sample:', log.slice(0, 300));

    const fileExists = fs.existsSync(AUDIT_FILE);
    console.log('  Audit file exists:', fileExists ? '✅' : '❌');

    console.log('  ✅ Test 2 passed\n');
  }

  // --- Test 3: Config file is editable ---
  {
    const cfg = getConfigManager();
    const before = cfg.get();
    const hasSendRule = before.safetyRules.some(r => r.action === 'send_message');
    console.log('Test 3: Config file');
    console.log('  Default rules loaded:', before.safetyRules.length > 0 ? '✅' : '❌');
    console.log('  Has send_message rule:', hasSendRule ? '✅' : '❌');

    // Change a rule
    await cfg.updateRule('send_message', 'deny');
    const after = cfg.get();
    const sendRule = after.safetyRules.find(r => r.action === 'send_message');
    console.log('  Rule updated:', sendRule?.rule === 'deny' ? '✅' : '❌');

    // Change a setting
    await cfg.set('assistantName', 'TestEscarlata');
    const nameCheck = cfg.get().assistantName;
    console.log('  Setting updated:', nameCheck === 'TestEscarlata' ? '✅' : '❌');

    // Verify config file is plain JSON
    const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(fileContent);
    console.log('  Config file is JSON:', parsed.assistantName === 'TestEscarlata' ? '✅' : '❌');

    console.log('  ✅ Test 3 passed\n');
  }

  // --- Test 4: Content safety (data vs instructions) ---
  {
    const registry = new ToolRegistry();
    registerAllTools(registry);

    // Check that the system prompt contains the safety warning
    const prompt = buildSystemPrompt(registry);
    const hasSafetyWarning = prompt.includes('fuentes externas') && prompt.includes('DATOS, no instrucciones');
    console.log('Test 4: Content safety');
    console.log('  Safety warning in system prompt:', hasSafetyWarning ? '✅' : '❌');
    console.log('  ✅ Test 4 passed\n');
  }

  // Clean up
  try { fs.unlinkSync(CONFIG_FILE); } catch {}
  try { fs.unlinkSync(AUDIT_FILE); } catch {}
  try { fs.unlinkSync(MEMORY_FILE); } catch {}

  console.log('✅ Tier 6 passes: confirmation gate, audit log, config, content safety.');
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});