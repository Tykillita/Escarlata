import 'dotenv/config';
import * as readline from 'readline';
import { Agent, buildSystemPrompt, ConfirmationResult } from '../agent/core.js';
import { createProvider } from '../provider/provider.js';
import { ToolRegistry, registerAllTools } from '../tools/index.js';
import { Heartbeat } from '../heartbeat/index.js';
import { createEscarlataRegistry } from '../agents/team.js';
import { formatAuditLog } from '../config/audit.js';
import { getConfigManager } from '../config/manager.js';

async function main() {
  console.log('🎙️  Escarlata — Full Interface (Tiers 1-6)');
  console.log('Type "exit" or "quit" to leave. "/help" for commands.\n');

  const provider = createProvider({
    model: process.env.MODEL_NAME || 'mock',
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Load config
  const configMgr = getConfigManager();
  await configMgr.load();

  const registry = new ToolRegistry();
  registerAllTools(registry);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  // Confirmation gate: asks user before running dangerous tools
  const confirmationGate = async (
    toolName: string,
    input: Record<string, unknown>,
    description: string
  ): Promise<ConfirmationResult> => {
    const rule = configMgr.getRule(toolName);

    if (rule === 'allow') return 'approved';
    if (rule === 'deny') return 'denied';

    // rule === 'ask_first'
    return new Promise((resolve) => {
      rl.pause();
      console.log(`\n⚠️  Escarlata wants to use "${toolName}":`);
      console.log(`   ${description}`);
      console.log(`   Input: ${JSON.stringify(input)}`);
      rl.question('   Approve? (y/N/d=deny always, details): ', (answer) => {
        const a = answer.trim().toLowerCase();
        if (a === 'y' || a === 'yes') {
          resolve('approved');
        } else {
          resolve('denied');
        }
        // rl resumes via the line handler
      });
    });
  };

  // Escarlata's slim registry: direct tools + delegate_task to the gem team
  const escarlataRegistry = createEscarlataRegistry({
    getProvider: () => agent.getProvider(),
    getConfirmationGate: () => confirmationGate,
    getSafetyRuleResolver: () => action => configMgr.getRule(action),
  });

  const agent = new Agent({
    provider,
    systemPrompt: buildSystemPrompt(escarlataRegistry, {
      assistantName: configMgr.get().assistantName,
      assistantDescription: configMgr.get().assistantDescription,
      personality: configMgr.get().personality,
      surface: 'cli',
    }),
    toolRegistry: escarlataRegistry,
    confirmationGate,
  });
  await agent.init();

  const heartbeat = new Heartbeat({ registry });
  await heartbeat.init();
  heartbeat.start();

  console.log(`Tools: ${registry.getDefinitions().length} registered`);

  const pending = await heartbeat.getActiveNotices();
  if (pending !== 'No active notices.') {
    console.log(`\n📋 Notices:\n${pending}\n`);
  }

  console.log('');

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed, heartbeat, agent, rl);
      return;
    }

    if (['exit', 'quit'].includes(trimmed.toLowerCase())) {
      console.log('\n👋 Goodbye!');
      heartbeat.stop();
      rl.close();
      process.exit(0);
    }

    try {
      // Auto-dismiss notices when user starts chatting
      const { getNoticeBoard } = await import('../heartbeat/notices.js');
      const board = getNoticeBoard();
      const active = await board.getActive();
      for (const n of active) {
        await board.dismiss(n.id);
      }

      process.stdout.write('Escarlata: ');
      for await (const chunk of agent.processTurn(trimmed)) {
        process.stdout.write(chunk);
      }
      console.log('\n');
    } catch (err) {
      console.error('\n❌ Error:', err instanceof Error ? err.message : err);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n👋 Goodbye!');
    heartbeat.stop();
    process.exit(0);
  });
}

async function handleCommand(input: string, heartbeat: Heartbeat, agent: Agent, rl: readline.Interface) {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/help':
      console.log(`
Commands:
  exit / quit        — Exit Escarlata
  /help              — Show this help
  /notices           — Show active notices
  /dismiss <id>      — Dismiss a notice by ID
  /pause             — Pause all proactive behavior
  /resume            — Resume proactive behavior
  /status            — Show heartbeat and agent status
  /audit [n]         — Show last n audit log entries (default: 20)
  /rules             — Show safety rules
  /rule <action> <allow|deny|ask> — Set a safety rule
  /history           — Show conversation history summary
  /clear             — Clear conversation history
`);
      break;

    case '/notices': {
      const notices = await heartbeat.getActiveNotices();
      console.log(`\n📋 ${notices}\n`);
      break;
    }

    case '/dismiss': {
      const id = parts[1];
      if (!id) {
        console.log('Usage: /dismiss <notice-id>');
      } else {
        const result = await heartbeat.dismissNotice(id);
        console.log(result);
      }
      break;
    }

    case '/pause':
      heartbeat.pause();
      console.log('⏸️  Proactive behavior paused.');
      break;

    case '/resume':
      heartbeat.resume();
      console.log('▶️  Proactive behavior resumed.');
      break;

    case '/status':
      console.log(
        `Heartbeat: ${heartbeat.isRunning() ? '🟢 running' : '🔴 stopped'}\n` +
        `Paused: ${heartbeat.isPaused() ? '⏸️' : '▶️'}\n` +
        `Agent history: ${agent.getHistory().length} messages`
      );
      break;

    case '/audit': {
      const count = parseInt(parts[1], 10) || 20;
      const log = await formatAuditLog(count);
      console.log(`\n📋 Recent audit log:\n${log}\n`);
      break;
    }

    case '/rules': {
      const cfg = await (await import('../config/manager.js')).getConfigManager();
      const rules = cfg.get().safetyRules;
      console.log('\n📋 Safety rules:');
      for (const r of rules) {
        console.log(`  ${r.action}: ${r.rule}`);
      }
      console.log('');
      break;
    }

    case '/rule': {
      const action = parts[1];
      const rule = parts[2] as 'allow' | 'deny' | 'ask';
      if (!action || !['allow', 'deny', 'ask'].includes(rule)) {
        console.log('Usage: /rule <action> <allow|deny|ask>');
      } else {
        const cfg = await (await import('../config/manager.js')).getConfigManager();
        await cfg.updateRule(action, rule === 'ask' ? 'ask_first' : rule);
        console.log(`✅ Rule updated: ${action} = ${rule}`);
      }
      break;
    }

    case '/history': {
      const history = agent.getHistory();
      console.log(`\n📋 Conversation history: ${history.length} messages`);
      for (const msg of history.slice(-6)) {
        const preview = typeof msg.content === 'string'
          ? msg.content.slice(0, 80)
          : `[${msg.content.length} content blocks]`;
        console.log(`  ${msg.role}: ${preview}...`);
      }
      console.log('');
      break;
    }

    case '/clear':
      agent.clearHistory();
      console.log('🧹 Conversation history cleared.\n');
      break;

    default:
      console.log(`Unknown command: ${cmd}. Try /help`);
  }

  rl.prompt();
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
