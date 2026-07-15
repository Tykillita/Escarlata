import 'dotenv/config';
import { ToolRegistry, registerAllTools } from '../tools/index.js';
import { resetMemoryStore } from '../memory/store.js';
import * as fs from 'fs';
import * as path from 'path';

const MEMORY_FILE = path.join(process.cwd(), 'data', 'test-memories.json');

async function test() {
  // Clean up any previous test data
  try { fs.unlinkSync(MEMORY_FILE); } catch {}
  process.env.MEMORY_FILE = MEMORY_FILE;

  // Force a fresh memory store by clearing module cache trick
  // Instead, use the tools directly which use getMemoryStore singleton

  const registry = new ToolRegistry();
  registerAllTools(registry);
  const rememberTool = registry.get('remember')!;
  const recallTool = registry.get('recall')!;
  const listTool = registry.get('list_memories')!;

  // --- Store a fact ---
  const result1 = await rememberTool.handler({
    content: 'User prefers morning meetings before 10am',
    category: 'preferences',
  });
  console.log('Store fact:', result1);

  // --- Verify it's retrievable ---
  const recall1 = await recallTool.handler({ query: 'morning' });
  console.log('Recall:', recall1);
  if (!recall1.includes('morning meetings')) {
    console.error('❌ Recall failed');
    process.exit(1);
  }
  console.log('✅ Memory recallable in-session');

  // --- Verify file exists and is readable ---
  if (!fs.existsSync(MEMORY_FILE)) {
    console.error('❌ Memory file not written to disk');
    process.exit(1);
  }
  const fileContent = fs.readFileSync(MEMORY_FILE, 'utf-8');
  const parsed = JSON.parse(fileContent);
  console.log(`\nMemory file entries: ${parsed.length}`);
  console.log('Entry content:', parsed[0]?.content);

  // File is plain JSON — human-readable
  console.log('✅ Memory file is human-readable JSON');

  // --- Simulate restart: close the singleton, reopen ---
  resetMemoryStore();
  const registry2 = new ToolRegistry();
  registerAllTools(registry2);
  const recallTool2 = registry2.get('recall')!;

  const recall2 = await recallTool2.handler({ query: 'morning' });
  console.log('\nAfter simulated restart - Recall:', recall2);
  if (!recall2.includes('morning meetings')) {
    console.error('❌ Memory did not survive simulated restart');
    process.exit(1);
  }
  console.log('✅ Memory survives restart (file-backed)');

  // --- Edit the file by hand and verify respect ---
  const manualEdit = parsed.map((f: any) =>
    f.id === parsed[0].id ? { ...f, content: 'User prefers afternoon meetings' } : f
  );
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(manualEdit, null, 2));

  resetMemoryStore();
  const registry3 = new ToolRegistry();
  registerAllTools(registry3);
  const recallTool3 = registry3.get('recall')!;

  const recall3 = await recallTool3.handler({ query: 'afternoon' });
  console.log('After manual edit - Recall:', recall3);
  if (!recall3.includes('afternoon meetings')) {
    console.error('❌ Manual edit not respected');
    process.exit(1);
  }
  console.log('✅ Manual edits to memory file are respected');

  // Clean up
  try { fs.unlinkSync(MEMORY_FILE); } catch {}

  console.log('\n✅ Tier 4 passes: memory persists, is inspectable, and editable.');
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});