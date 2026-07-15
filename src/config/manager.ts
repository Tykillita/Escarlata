import { promises as fs } from 'fs';
import * as path from 'path';
import type { AuthMethod } from '../provider/types.js';

export interface SafetyRule {
  action: string;
  rule: 'allow' | 'deny' | 'ask_first';
}

export interface EscarlataConfig {
  assistantName: string;
  assistantDescription: string;
  personality: string;
  modelProvider: string;
  modelName: string;
  safetyRules: SafetyRule[];
  heartbeatQuietStart: number;
  heartbeatQuietEnd: number;
  heartbeatTickInterval: number;
  apiKeys: Record<string, string>;
  authMethods: Record<string, AuthMethod>;
}

export function getConfigPath(): string {
  return process.env.CONFIG_FILE || path.join(process.cwd(), 'data', 'config.json');
}

const DEFAULTS: EscarlataConfig = {
  assistantName: 'Escarlata',
  assistantDescription: 'A warm, casual voice-first AI assistant that remembers you and acts on your behalf.',
  personality: 'Warm, plain-spoken, and brief. Speak like a capable colleague who respects your time.',
  modelProvider: 'mock',
  modelName: 'mock',
  safetyRules: [
    { action: 'send_message', rule: 'ask_first' },
    { action: 'spend_money', rule: 'ask_first' },
    { action: 'delete_data', rule: 'ask_first' },
    { action: 'post_online', rule: 'ask_first' },
    { action: 'forget', rule: 'ask_first' },
    { action: 'modify_file', rule: 'ask_first' },
    { action: 'modify_calendar', rule: 'ask_first' },
  ],
  heartbeatQuietStart: 23,
  heartbeatQuietEnd: 6,
  heartbeatTickInterval: 30,
  apiKeys: {},
  authMethods: {},
};

export class ConfigManager {
  private config: EscarlataConfig = { ...DEFAULTS };
  private loaded = false;

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(getConfigPath(), 'utf-8');
      const parsed = JSON.parse(data);
      this.config = {
        ...DEFAULTS,
        ...parsed,
        apiKeys: { ...DEFAULTS.apiKeys, ...(parsed.apiKeys || {}) },
        authMethods: { ...DEFAULTS.authMethods, ...(parsed.authMethods || {}) },
      };
    } catch {
      this.config = { ...DEFAULTS };
      await this.save(); // Write defaults
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
    await fs.writeFile(getConfigPath(), JSON.stringify(this.config, null, 2), 'utf-8');
  }

  get(): EscarlataConfig {
    return structuredClone(this.config);
  }

  getRule(action: string): SafetyRule['rule'] {
    const found = this.config.safetyRules.find(r => r.action === action);
    return found ? found.rule : 'ask_first'; // Default: ask
  }

  async updateRule(action: string, rule: SafetyRule['rule']): Promise<void> {
    const existing = this.config.safetyRules.find(r => r.action === action);
    if (existing) {
      existing.rule = rule;
    } else {
      this.config.safetyRules.push({ action, rule });
    }
    await this.save();
  }

  async set<K extends keyof EscarlataConfig>(key: K, value: EscarlataConfig[K]): Promise<void> {
    this.config[key] = value;
    await this.save();
  }

  async setApiKey(provider: string, key: string): Promise<void> {
    this.config.apiKeys[provider] = key;
    await this.save();
  }

  getApiKey(provider: string): string {
    return this.config.apiKeys[provider] || '';
  }

  async removeApiKey(provider: string): Promise<void> {
    delete this.config.apiKeys[provider];
    await this.save();
  }
}

let _instance: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!_instance) {
    _instance = new ConfigManager();
  }
  return _instance;
}

export function resetConfigManager(): void {
  _instance = null;
}
