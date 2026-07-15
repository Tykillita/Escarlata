import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { getCodexAppServer } from './codex-app-server.js';

const execFileAsync = promisify(execFile);

export type OAuthProvider = 'anthropic' | 'openai';
export type ProviderAuthState = 'disconnected' | 'connecting' | 'connected' | 'expired' | 'unavailable' | 'error';

export interface ProviderAuthStatus {
  provider: OAuthProvider;
  method: 'oauth_local';
  state: ProviderAuthState;
  message?: string;
  authUrl?: string;
}

type Listener = (status: ProviderAuthStatus) => void;

interface CodexAuthClient {
  ensureStarted(): Promise<void>;
  request(method: string, params?: Record<string, unknown>): Promise<any>;
  onMessage(listener: (message: any) => void): () => void;
}

export interface AuthServiceDependencies {
  readClaudeStatus: () => Promise<any>;
  launchClaudeLogin: () => ChildProcess;
  codex: CodexAuthClient;
}

function defaultDependencies(): AuthServiceDependencies {
  const executable = process.env.CLAUDE_CLI_PATH || 'claude';
  return {
    readClaudeStatus: async () => {
      const { stdout } = await execFileAsync(executable, ['auth', 'status', '--json'], {
        timeout: 10_000,
        windowsHide: true,
      });
      return JSON.parse(stdout);
    },
    launchClaudeLogin: () => spawn(executable, ['auth', 'login', '--claudeai'], {
      stdio: 'ignore', windowsHide: true,
    }),
    codex: getCodexAppServer(),
  };
}

export class ProviderAuthService {
  private listeners = new Set<Listener>();
  private claudeLogin: ChildProcess | null = null;
  private codexLoginId: string | null = null;
  private codexListening = false;

  constructor(private dependencies: AuthServiceDependencies = defaultDependencies()) {}

  onStatus(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(status: ProviderAuthStatus): ProviderAuthStatus {
    for (const listener of this.listeners) listener(status);
    return status;
  }

  report(provider: OAuthProvider, message: string, expired = false): ProviderAuthStatus {
    return this.emit({ provider, method: 'oauth_local', state: expired ? 'expired' : 'error', message });
  }

  async getStatus(provider: OAuthProvider): Promise<ProviderAuthStatus> {
    return provider === 'anthropic' ? this.getClaudeStatus() : this.getOpenAIStatus();
  }

  private async getClaudeStatus(): Promise<ProviderAuthStatus> {
    try {
      const data = await this.dependencies.readClaudeStatus();
      return {
        provider: 'anthropic',
        method: 'oauth_local',
        state: data.loggedIn && data.authMethod === 'claude.ai' ? 'connected' : 'disconnected',
        message: data.loggedIn ? `Claude ${data.subscriptionType || 'account'}` : 'No hay una sesión de Claude activa',
      };
    } catch (error: any) {
      const unavailable = error?.code === 'ENOENT';
      return {
        provider: 'anthropic', method: 'oauth_local',
        state: unavailable ? 'unavailable' : 'error',
        message: unavailable ? 'No se encontró claude.exe' : 'No se pudo consultar la sesión de Claude',
      };
    }
  }

  private listenToCodex(): void {
    if (this.codexListening) return;
    this.codexListening = true;
    this.dependencies.codex.onMessage(message => {
      if (message.method !== 'account/login/completed') return;
      const params = message.params || {};
      if (this.codexLoginId && params.loginId !== this.codexLoginId) return;
      this.codexLoginId = null;
      this.emit({
        provider: 'openai', method: 'oauth_local',
        state: params.success ? 'connected' : 'error',
        message: params.success ? 'ChatGPT conectado' : String(params.error || 'No se completó el login de ChatGPT'),
      });
    });
  }

  private async getOpenAIStatus(): Promise<ProviderAuthStatus> {
    try {
      const client = this.dependencies.codex;
      await client.ensureStarted();
      this.listenToCodex();
      const result = await client.request('account/read', { refreshToken: false });
      const connected = result.account?.type === 'chatgpt';
      return {
        provider: 'openai', method: 'oauth_local',
        state: connected ? 'connected' : 'disconnected',
        message: connected ? `ChatGPT ${result.account.planType || 'account'}` : 'No hay una sesión de ChatGPT activa',
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      const expired = /unauthorized|authentication|login|401/i.test(message);
      return {
        provider: 'openai', method: 'oauth_local',
        state: /ENOENT|not found|no se reconoce|failed to spawn/i.test(message) ? 'unavailable' : expired ? 'expired' : 'error',
        message: /ENOENT|not found|no se reconoce/i.test(message)
          ? 'No se encontró codex.exe'
          : expired ? 'La sesión de ChatGPT expiró; vuelve a conectarla' : 'No se pudo consultar la sesión de ChatGPT',
      };
    }
  }

  async start(provider: OAuthProvider): Promise<ProviderAuthStatus> {
    return provider === 'anthropic' ? this.startClaude() : this.startOpenAI();
  }

  private async startClaude(): Promise<ProviderAuthStatus> {
    if (this.claudeLogin) return this.emit({
      provider: 'anthropic', method: 'oauth_local', state: 'connecting', message: 'El login de Claude está en curso',
    });
    const status = this.emit({
      provider: 'anthropic', method: 'oauth_local', state: 'connecting',
      message: 'Completa el login en el navegador del equipo host. Alternativa: claude auth login --claudeai',
    });
    const child = this.dependencies.launchClaudeLogin();
    this.claudeLogin = child;
    child.once('error', error => {
      this.claudeLogin = null;
      this.emit({
        provider: 'anthropic', method: 'oauth_local',
        state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unavailable' : 'error',
        message: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'No se encontró claude.exe' : 'No se pudo iniciar el login de Claude',
      });
    });
    child.once('exit', async code => {
      this.claudeLogin = null;
      if (code === 0) this.emit(await this.getClaudeStatus());
      else this.emit({ provider: 'anthropic', method: 'oauth_local', state: 'error', message: 'El login de Claude no se completó' });
    });
    return status;
  }

  private async startOpenAI(): Promise<ProviderAuthStatus> {
    try {
      const client = this.dependencies.codex;
      await client.ensureStarted();
      this.listenToCodex();
      const result = await client.request('account/login/start', {
        type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt',
      });
      this.codexLoginId = result.loginId;
      return this.emit({
        provider: 'openai', method: 'oauth_local', state: 'connecting',
        message: 'Completa el login de ChatGPT en el navegador', authUrl: result.authUrl,
      });
    } catch (error: any) {
      return this.emit({
        provider: 'openai', method: 'oauth_local', state: error?.code === 'ENOENT' ? 'unavailable' : 'error',
        message: error?.code === 'ENOENT' ? 'No se encontró codex.exe' : 'No se pudo iniciar el login de ChatGPT',
      });
    }
  }

  async cancel(provider: OAuthProvider): Promise<ProviderAuthStatus> {
    if (provider === 'anthropic') {
      this.claudeLogin?.kill();
      this.claudeLogin = null;
    } else if (this.codexLoginId) {
      await this.dependencies.codex.request('account/login/cancel', { loginId: this.codexLoginId });
      this.codexLoginId = null;
    }
    return this.emit({ provider, method: 'oauth_local', state: 'disconnected', message: 'Login cancelado' });
  }
}

let singleton: ProviderAuthService | null = null;
export function getProviderAuthService(): ProviderAuthService {
  singleton ||= new ProviderAuthService();
  return singleton;
}
