export interface ToolDef {
  name: string;
  description: string;
  requiresConfirmation?: boolean;
}

export interface MemoryCandidate {
  id: string;
  content: string;
  category: string;
  createdAt: string;
}

export interface MemoryFact {
  id: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoticeAction {
  label: string;
  command: string; // se manda como mensaje al agente
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'notice' | 'important';
  source: string;
  createdAt: string;
  dismissed: boolean;
  actions?: NoticeAction[];
}

export interface DesktopPreferences {
  notifications: { enabled: boolean; minimumSeverity: 'info' | 'notice' | 'important'; sound: boolean; doNotDisturb: { enabled: boolean; startHour: number; endHour: number; allowImportant: boolean } };
  tray: { enabled: boolean; showUnreadBadge: boolean; closeToTray: boolean; minimizeToTray: boolean };
  startup: { enabled: boolean; startMinimized: boolean };
}

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

export type AuthMethod = 'api_key' | 'oauth_local';
export type ProviderAuthState = 'disconnected' | 'connecting' | 'connected' | 'expired' | 'unavailable' | 'error';

export interface ProviderAuthStatus {
  provider: 'anthropic' | 'openai';
  method: 'oauth_local';
  state: ProviderAuthState;
  message?: string;
  authUrl?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tokens?: string[];
  isStreaming?: boolean;
}

export interface ChatFolder {
  id: string;
  name: string;
}

// Carpetas de la página de chats — persistidas en el servidor, sincronizadas entre dispositivos
export interface ChatFolderState {
  folders: ChatFolder[];
  assign: Record<string, string>; // convId -> folderId
}

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export type PanelView = 'chat' | 'tools' | 'memory' | 'audit' | 'config' | 'activity';

export interface AgentActivity {
  id: string;
  type: 'tool_start' | 'tool_result';
  name: string;
  input: Record<string, unknown>;
  result?: string;
  duration?: number;
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface VaultFile {
  name: string;
  path: string;
  modifiedAt: string;
}

// Mirrors src/server/usage.ts VitalMetric — keep in sync manually.
export interface VitalMetric {
  label: string;
  value: string;
  trend?: 'up' | 'down';
  delta?: string;
  period?: string;
  note?: string;
  sparkData: number[];
  bar?: number; // 0-100; when set, render a progress bar instead of the sparkline
  subvalue?: string;
  visual?: 'spark' | 'none';
  group?: 'plan_allowance' | 'token_breakdown' | 'provider_selector';
}

export type VitalsProvider = 'anthropic' | 'openai';
export type VitalsByProvider = Record<VitalsProvider, VitalMetric[] | null>;

// Mirrors src/server/stats.ts UsageStatsDay — keep in sync manually.
export interface UsageStatsDay {
  date: string; // YYYY-MM-DD local
  messages: number;
  hourCounts: number[]; // 24 buckets
  sessionIds: string[];
  models: { model: string; provider: 'anthropic' | 'openai'; input: number; output: number; messages: number }[];
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface LocalModelFile {
  name: string;
  path: string;
  size: number;
  modelName?: string;
}

export interface DirectiveItem {
  text: string;
  checked: boolean;
}

export interface LinkStatus {
  ollama: boolean;
  whisper: boolean;
  ngrok: boolean;
}

export interface SystemStatus {
  provider: string;
  model: string;
  link: LinkStatus;
  runner: 'standby' | 'processing' | 'tool_call';
  queue: number;
}
