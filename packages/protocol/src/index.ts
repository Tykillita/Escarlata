import { z } from 'zod';

const shortText = z.string().trim().max(500);
const id = z.string().trim().min(1).max(128);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), content: z.string().trim().min(1).max(32_000), requestId: id.optional() }),
  z.object({ type: z.literal('audio'), data: z.string().max(14_000_000), mime: z.string().max(100).optional(), requestId: id.optional() }),
  z.object({ type: z.literal('confirm'), id, decision: z.enum(['approved', 'denied']) }),
  z.object({ type: z.literal('get_state') }),
  z.object({ type: z.literal('get_memories') }), z.object({ type: z.literal('get_notices') }), z.object({ type: z.literal('get_vault_files') }),
  z.object({ type: z.literal('get_directives') }), z.object({ type: z.literal('get_ollama_models') }),
  z.object({ type: z.literal('new_chat') }), z.object({ type: z.literal('clear_history') }), z.object({ type: z.literal('abort') }),
  z.object({ type: z.literal('switch_chat'), id }), z.object({ type: z.literal('delete_conversation'), id }),
  z.object({ type: z.literal('rename_conversation'), id, title: shortText }),
  z.object({ type: z.literal('delete_memory'), id }), z.object({ type: z.literal('dismiss_notice'), id }),
  z.object({ type: z.literal('edit_message'), messageId: id, content: z.string().trim().min(1).max(32_000) }),
  z.object({ type: z.literal('set_heartbeat'), paused: z.boolean() }),
  z.object({ type: z.literal('scan_models_dir'), directory: z.string().min(1).max(1_024) }),
  z.object({ type: z.literal('set_models_dir'), directory: z.string().max(1_024) }),
  z.object({ type: z.literal('set_chat_folders'), folders: z.array(z.object({ id, name: shortText })).max(100), assign: z.record(z.string(), z.string()) }),
  z.object({ type: z.literal('set_provider'), provider: shortText, model: shortText, authMethod: z.enum(['api_key', 'oauth_local']), apiKey: z.string().max(8_192).optional() }),
  z.object({ type: z.literal('get_provider_auth'), provider: z.enum(['anthropic', 'openai']) }),
  z.object({ type: z.literal('start_provider_auth'), provider: z.enum(['anthropic', 'openai']) }),
  z.object({ type: z.literal('cancel_provider_auth'), provider: z.enum(['anthropic', 'openai']) }),
  z.object({ type: z.literal('get_vitals'), provider: z.enum(['anthropic', 'openai']) }),
  z.object({ type: z.literal('sync_link'), uid: z.string().trim().min(1).max(256) }),
  z.object({ type: z.literal('sync_unlink') }),
  z.object({ type: z.literal('sync_now'), scope: z.enum(['heart', 'vault']).optional() }),
  z.object({ type: z.literal('get_auth_status') }),
  z.object({ type: z.literal('setup_local_account'), username: z.string().trim().min(2).max(80), password: z.string().min(10).max(256), enableWindowsHello: z.boolean().optional(), rememberSession: z.boolean().optional() }),
  z.object({ type: z.literal('login_local'), username: z.string().trim().min(2).max(80), password: z.string().min(1).max(256), rememberSession: z.boolean().optional() }),
  z.object({ type: z.literal('identify_local_account'), username: z.string().trim().min(2).max(80) }),
  z.object({ type: z.literal('login_windows_hello'), username: z.string().trim().min(2).max(80).optional(), rememberSession: z.boolean().optional() }),
  z.object({ type: z.literal('set_windows_hello'), enabled: z.boolean() }),
  z.object({ type: z.literal('set_remember_session'), enabled: z.boolean() }),
  z.object({ type: z.literal('verify_windows_hello') }),
  z.object({ type: z.literal('choose_vault_directory') }),
  z.object({ type: z.literal('choose_models_directory') }),
  z.object({ type: z.literal('choose_directives_file') }),
  z.object({ type: z.literal('window_control'), action: z.enum(['minimize', 'toggle_maximize', 'close']) }),
  z.object({ type: z.literal('get_desktop_preferences') }),
  z.object({ type: z.literal('set_desktop_preferences'), preferences: z.object({
    notifications: z.object({ enabled: z.boolean(), minimumSeverity: z.enum(['info', 'notice', 'important']), sound: z.boolean(), doNotDisturb: z.object({ enabled: z.boolean(), startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(0).max(23), allowImportant: z.boolean() }) }),
    tray: z.object({ enabled: z.boolean(), showUnreadBadge: z.boolean(), closeToTray: z.boolean(), minimizeToTray: z.boolean() }),
    startup: z.object({ enabled: z.boolean(), startMinimized: z.boolean() }),
  }) }),
  z.object({ type: z.literal('open_notification_center') }),
  z.object({ type: z.literal('test_desktop_notification') }),
  z.object({ type: z.literal('complete_onboarding'), modelProvider: shortText, modelName: shortText, configureMultiple: z.boolean(), vaultDirectory: z.string().min(1).max(1_024), directivesMode: z.enum(['existing', 'create']).optional(), directivesFile: z.string().trim().max(1_024).optional(), primaryUses: z.array(shortText).min(1).max(12), otherUse: z.string().trim().max(300).optional() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.object({
  type: z.string().min(1).max(100),
  requestId: id.optional(),
}).passthrough();

export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Desktop uses the same semantics as the legacy transport, but only through IPC. */
export const desktopCommandSchema = clientMessageSchema;
export type DesktopCommand = z.infer<typeof desktopCommandSchema>;
export const desktopEventSchema = serverMessageSchema;
export type DesktopEvent = z.infer<typeof desktopEventSchema>;

export const syncEnvelopeSchema = z.object({
  operationId: z.string().uuid(), deviceId: z.string().uuid(),
  entity: z.enum(['conversation', 'message', 'memory', 'memoryCandidate', 'note', 'reminder', 'notice', 'preference']),
  entityId: z.string().min(1).max(128), operation: z.enum(['upsert', 'delete']), revision: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()).optional(), createdAt: z.string().datetime(),
});
export type SyncEnvelope = z.infer<typeof syncEnvelopeSchema>;

export interface PublicConfig {
  assistantName: string;
  assistantDescription: string;
  personality: string;
  modelProvider: string;
  modelName: string;
  safetyRules: { action: string; rule: 'allow' | 'deny' | 'ask_first' }[];
  heartbeatQuietStart: number;
  heartbeatQuietEnd: number;
  heartbeatTickInterval: number;
  authMethods: Record<string, 'api_key' | 'oauth_local'>;
  credentialStatus: Record<string, boolean>;
}

export interface ApiError {
  type: 'error';
  code: string;
  message: string;
  requestId?: string;
}
