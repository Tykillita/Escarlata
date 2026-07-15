import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

type MessageHandler = (message: any) => void;

export function resolveCodexExecutable(): string {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  const platform = process.platform;
  const arch = process.arch;
  const packageName = `codex-${platform}-${arch}`;
  const triple = platform === 'win32'
    ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : platform === 'darwin'
      ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
      : `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`;
  const binary = platform === 'win32' ? 'codex.exe' : 'codex';
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const requireFromHere = createRequire(import.meta.url);
  const candidates: string[] = [];

  // Resolve the optional native package through Node so startup does not depend
  // on the process working directory (services and launchers often change it).
  try {
    const nativePackage = requireFromHere.resolve(`@openai/${packageName}/package.json`);
    candidates.push(path.join(path.dirname(nativePackage), 'vendor', triple, 'bin', binary));
  } catch {
    // Keep module-relative fallbacks for source and compiled executions.
  }
  candidates.push(
    path.resolve(moduleDir, '..', '..', 'node_modules', '@openai', packageName, 'vendor', triple, 'bin', binary),
  );

  const resolved = candidates.find(candidate => existsSync(candidate));
  if (!resolved) return 'codex';
  // Native executables cannot be spawned from Electron's app.asar archive. The
  // builder unpacks the Codex platform package alongside the archive instead.
  const unpacked = resolved.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  return existsSync(unpacked) ? unpacked : resolved;
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private handlers = new Set<MessageHandler>();

  async ensureStarted(): Promise<void> {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start();
    try { await this.startPromise; } finally { this.startPromise = null; }
  }

  private async start(): Promise<void> {
    const executable = resolveCodexExecutable();
    const child = spawn(executable, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, LOG_FORMAT: 'json' },
    });
    this.child = child;

    const startup = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.stderr.on('data', data => {
      const text = String(data).trim();
      if (text) console.warn(`[codex-app-server] ${text.slice(0, 500)}`);
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      const error = new Error(`codex app-server terminó (${code ?? signal ?? 'unknown'})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });

    createInterface({ input: child.stdout }).on('line', line => {
      if (!line.trim()) return;
      try { this.handle(JSON.parse(line)); }
      catch { console.warn('[codex-app-server] Respuesta JSON inválida'); }
    });

    try {
      await startup;
      await this.request('initialize', {
        clientInfo: { name: 'escarlata', title: 'Escarlata', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      this.notify('initialized', {});
    } catch (error) {
      this.child = null;
      child.kill();
      throw error;
    }
  }

  private handle(message: any): void {
    if (typeof message.id === 'number' && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Error de codex app-server'));
      else pending.resolve(message.result);
      return;
    }
    for (const handler of this.handlers) handler(message);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!this.child) return Promise.reject(new Error('codex app-server no está iniciado'));
    const id = ++this.requestId;
    const promise = new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return promise;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    if (!this.child) return;
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id: number, result: unknown): void {
    if (!this.child) return;
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

let singleton: CodexAppServerClient | null = null;
export function getCodexAppServer(): CodexAppServerClient {
  singleton ||= new CodexAppServerClient();
  return singleton;
}
