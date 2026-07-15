import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { ProviderAuthService, type AuthServiceDependencies, type ProviderAuthStatus } from '../provider/auth-service.js';
import { resolveCodexExecutable } from '../provider/codex-app-server.js';
import { createProvider } from '../provider/provider.js';

class FakeCodex {
  handlers = new Set<(message: any) => void>();
  account: any = { type: 'chatgpt', planType: 'plus' };
  cancelled = false;
  async ensureStarted() {}
  async request(method: string): Promise<any> {
    if (method === 'account/read') return { account: this.account, requiresOpenaiAuth: true };
    if (method === 'account/login/start') return { loginId: 'login-1', authUrl: 'https://example.test/login' };
    if (method === 'account/login/cancel') { this.cancelled = true; return {}; }
    throw new Error(`Unexpected method: ${method}`);
  }
  onMessage(handler: (message: any) => void) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  emit(message: any) { for (const handler of this.handlers) handler(message); }
}

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.kill = (() => true) as ChildProcess['kill'];
  return child;
}

async function testAuthService() {
  const codex = new FakeCodex();
  const dependencies: AuthServiceDependencies = {
    readClaudeStatus: async () => ({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }),
    launchClaudeLogin: fakeChild,
    codex,
  };
  const service = new ProviderAuthService(dependencies);
  const events: ProviderAuthStatus[] = [];
  service.onStatus(status => events.push(status));

  assert.equal((await service.getStatus('anthropic')).state, 'connected');
  assert.equal((await service.getStatus('openai')).state, 'connected');

  const started = await service.start('openai');
  assert.equal(started.state, 'connecting');
  assert.equal(started.authUrl, 'https://example.test/login');
  codex.emit({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } });
  assert.equal(events.at(-1)?.state, 'connected');

  await service.start('openai');
  await service.cancel('openai');
  assert.equal(codex.cancelled, true);

  const unavailable = new ProviderAuthService({
    ...dependencies,
    readClaudeStatus: async () => { const error: NodeJS.ErrnoException = new Error('missing'); error.code = 'ENOENT'; throw error; },
  });
  assert.equal((await unavailable.getStatus('anthropic')).state, 'unavailable');
}

async function testProviderSelection() {
  process.env.MODEL_PROVIDER = 'anthropic';
  assert.equal(createProvider({ model: 'claude-test', authMethod: 'oauth_local' }).constructor.name, 'ClaudeOAuthProvider');
  process.env.MODEL_PROVIDER = 'openai';
  assert.equal(createProvider({ model: 'gpt-test', authMethod: 'oauth_local' }).constructor.name, 'CodexOAuthProvider');
  assert.equal(createProvider({ model: 'gpt-test', authMethod: 'api_key', apiKey: 'test-key' }).constructor.name, 'OpenAIProvider');
}

async function testLegacyConfigMigration() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'escarlata-auth-test-'));
  const file = path.join(dir, 'config.json');
  await fs.writeFile(file, JSON.stringify({ modelProvider: 'anthropic', modelName: 'legacy', apiKeys: { anthropic: 'secret' } }));
  process.env.CONFIG_FILE = file;
  const { ConfigManager } = await import('../config/manager.js');
  const manager = new ConfigManager();
  await manager.load();
  assert.deepEqual(manager.get().authMethods, {});
  assert.equal(manager.get().apiKeys.anthropic, 'secret');
  await fs.rm(dir, { recursive: true, force: true });
}

function testCodexResolutionOutsideWorkspace() {
  const originalCwd = process.cwd();
  try {
    process.chdir(os.tmpdir());
    const executable = resolveCodexExecutable();
    assert.notEqual(executable, 'codex');
    assert.equal(path.basename(executable), process.platform === 'win32' ? 'codex.exe' : 'codex');
  } finally {
    process.chdir(originalCwd);
  }
}

await testAuthService();
await testProviderSelection();
await testLegacyConfigMigration();
testCodexResolutionOutsideWorkspace();
console.log('provider-auth: ok');
