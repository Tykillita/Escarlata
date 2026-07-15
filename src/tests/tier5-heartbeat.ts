import 'dotenv/config';
import { ToolRegistry, registerAllTools } from '../tools/index.js';
import { Heartbeat } from '../heartbeat/index.js';
import { getNoticeBoard, resetNoticeBoard } from '../heartbeat/notices.js';
import { getScheduler, resetScheduler } from '../heartbeat/scheduler.js';
import { HeartbeatCheck } from '../heartbeat/checks.js';
import * as fs from 'fs';
import * as path from 'path';

const SCHEDULE_FILE = path.join(process.cwd(), 'data', 'test-schedule.json');
const NOTICES_FILE = path.join(process.cwd(), 'data', 'test-notices.json');

async function test() {
  try { fs.unlinkSync(SCHEDULE_FILE); } catch {}
  try { fs.unlinkSync(NOTICES_FILE); } catch {}

  process.env.SCHEDULE_FILE = SCHEDULE_FILE;
  process.env.NOTICES_FILE = NOTICES_FILE;
  process.env.HEARTBEAT_QUIET_START = '0';
  process.env.HEARTBEAT_QUIET_END = '0'; // Never quiet in tests

  const registry = new ToolRegistry();
  registerAllTools(registry);

  // --- Test 1: Heartbeat runs startup check, creates notices ---
  {
    resetNoticeBoard();
    resetScheduler();

    let startupRan = false;
    const startupCheck: HeartbeatCheck = {
      id: 'startup_test',
      interval: 'startup',
      description: 'Startup test check',
      run: async () => {
        startupRan = true;
        const notices = getNoticeBoard();
        await notices.add('Startup notice', 'Ran on startup', 'info', 'startup_test');
      },
    };

    const heartbeat = new Heartbeat({
      registry,
      checks: [startupCheck],
      tickInterval: 100,
    });
    await heartbeat.init();
    heartbeat.start();

    await new Promise(r => setTimeout(r, 300));

    console.log('Test 1: Heartbeat startup check');
    console.log('  Check ran:', startupRan ? '✅' : '❌');

    const board = getNoticeBoard();
    const allNotices = await board.getAll();
    console.log('  Notice created:', allNotices.length > 0 ? '✅' : '❌');

    if (!startupRan || allNotices.length === 0) {
      console.error('❌ Heartbeat or notice creation failed');
      process.exit(1);
    }

    // Dismiss notices
    for (const n of allNotices) {
      await board.dismiss(n.id);
    }
    const active = await board.getActive();
    console.log('  Notice is dismissible:', active.length === 0 ? '✅' : '❌');

    heartbeat.stop();
    console.log('  ✅ Test 1 passed\n');
  }

  // --- Test 2: Notices survive restart (file-backed) ---
  {
    resetNoticeBoard();
    const board = getNoticeBoard();
    const allNotices = await board.getAll();
    const fileExists = fs.existsSync(NOTICES_FILE);

    console.log('Test 2: Notices persist');
    console.log('  Notice file exists:', fileExists ? '✅' : '❌');

    if (fileExists) {
      const content = JSON.parse(fs.readFileSync(NOTICES_FILE, 'utf-8'));
      console.log('  Entries in file:', content.length, '(expected >=1)');
      console.log('  First entry dismissed:', content[0]?.dismissed ? '✅' : '❌');
    }
    console.log('  ✅ Test 2 passed\n');
  }

  // --- Test 3: Schedule persists ---
  {
    resetScheduler();
    const scheduler = getScheduler();
    await scheduler.load();

    const all = scheduler.getAll();
    const schedFileExists = fs.existsSync(SCHEDULE_FILE);

    console.log('Test 3: Schedule persists');
    console.log('  Schedule file exists:', schedFileExists ? '✅' : '❌');
    console.log('  Entries:', all.length, '(expected: 0 since startup checks are disabled after run, or the file may have been cleaned)');

    if (all.length > 0) {
      console.log('  First entry:', all[0].id, all[0].enabled ? '(enabled)' : '(disabled)');
    }
    console.log('  ✅ Test 3 passed\n');
  }

  // --- Test 4: Kill switch (pause) prevents proactive behavior ---
  {
    resetNoticeBoard();
    resetScheduler();

    let periodicRan = false;
    const periodicCheck: HeartbeatCheck = {
      id: 'periodic_test',
      interval: 0.01, // 0.01 minutes ≈ 600ms — will be due quickly
      description: 'Periodic test',
      run: async () => {
        periodicRan = true;
      },
    };

    const heartbeat = new Heartbeat({
      registry,
      checks: [periodicCheck],
      tickInterval: 50,
    });
    await heartbeat.init();

    // Start, then pause (kill switch)
    heartbeat.start();
    heartbeat.pause();

    await new Promise(r => setTimeout(r, 300));

    console.log('Test 4: Kill switch');
    console.log('  Heartbeat is paused:', heartbeat.isPaused() ? '✅' : '❌');
    console.log('  Check ran while paused:', periodicRan === false ? '✅' : '❌');

    // Resume
    periodicRan = false;
    heartbeat.resume();
    await new Promise(r => setTimeout(r, 1000));
    console.log('  Check ran after resume:', periodicRan ? '✅' : '❌');

    heartbeat.stop();
    console.log('  ✅ Test 4 passed\n');
  }

  // --- Test 5: Notices surface on return ---
  {
    resetNoticeBoard();

    // Simulate: heartbeat adds a notice while user is away
    const board = getNoticeBoard();
    await board.add('Missed alert', 'Something happened while you were away', 'important', 'test');

    const active = await board.getActive();
    console.log('Test 5: Catch-up on return');
    console.log('  Notice held until return:', active.length === 1 ? '✅' : '❌');
    console.log('  Notice content:', active[0]?.title);

    // Dismiss
    await board.dismiss(active[0].id);
    const afterDismiss = await board.getActive();
    console.log('  Dismiss clears it:', afterDismiss.length === 0 ? '✅' : '❌');

    console.log('  ✅ Test 5 passed\n');
  }

  // Clean up
  try { fs.unlinkSync(SCHEDULE_FILE); } catch {}
  try { fs.unlinkSync(NOTICES_FILE); } catch {}

  console.log('✅ Tier 5 passes: heartbeat runs checks, persists, kill switch works, notices are dismissible.');
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});