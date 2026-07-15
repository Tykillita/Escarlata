import { useState, useEffect, useCallback, useRef } from 'react';
import { useDesktopBridge } from './hooks/useDesktopBridge';
import { useVoice } from './hooks/useVoice';
import { StatusRow } from './components/StatusRow';
import { SidebarLeft } from './components/SidebarLeft';
import { SidebarRight } from './components/SidebarRight';
import { ResizeHandle } from './components/ResizeHandle';
import { ParticleSphere } from './components/ParticleSphere';
import { HeroMetric } from './components/HeroMetric';
import { FloatingNotice } from './components/FloatingNotice';
import { NoticeIcon, cleanNoticeTitle } from './components/NoticeIcon';
import { PerspectiveGrid } from './components/PerspectiveGrid';
import { TerminalOverlay, TOOL_NOTICE_MS } from './components/TerminalOverlay';
import { ChatPage } from './components/ChatPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { Message, ToolDef, MemoryFact, MemoryCandidate, Notice, EscarlataConfig, WsMessage, VaultFile, DirectiveItem, Conversation, VitalMetric, VitalsProvider, VitalsByProvider, UsageStatsDay, SystemStatus, LinkStatus, OllamaModelInfo, LocalModelFile, ChatFolderState, AuthMethod, ProviderAuthStatus, DesktopPreferences } from './types';
import type { ToolActivity } from './components/TerminalOverlay';
import { ModelConfigPanel } from './components/ModelConfigPanel';
import { SyncSettings } from './components/SyncSettings';
import { LoginPage } from './components/LoginPage';
import { OnboardingWizard } from './components/OnboardingWizard';
import { DesktopWindowFrame } from './components/DesktopWindowChrome';
import { AppSettings } from './components/AppSettings';

const LOAD_TS = Date.now();
const INTRO_MS = 5000;

function cycleHue() {
  const root = document.documentElement;
  const elapsed = Date.now() - LOAD_TS;
  if (elapsed < INTRO_MS) {
    const p = elapsed / INTRO_MS;
    const hue = 348 + p * 12;
    root.style.setProperty('--accent-hue', String(Math.round(hue % 360)));
    root.style.setProperty('--accent-lit', `${35 + p * 15}%`);
    return;
  }
  root.style.setProperty('--accent-lit', '50%');
  const t = ((elapsed - INTRO_MS) % 300000) / 300000;
  let hue: number;
  if (t < 0.2) hue = (t / 0.2) * 30;
  else if (t < 0.35) hue = 30 + ((t - 0.2) / 0.15) * 110;
  else if (t < 0.5) hue = 140 + ((t - 0.35) / 0.15) * 50;
  else if (t < 0.65) hue = 190 - ((t - 0.5) / 0.15) * 50;
  else if (t < 0.8) hue = 140 - ((t - 0.65) / 0.15) * 110;
  else hue = 30 - ((t - 0.8) / 0.2) * 30;
  root.style.setProperty('--accent-hue', String(Math.round(hue)));
}

export default function App() {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [chatPageOpen, setChatPageOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [openNotice, setOpenNotice] = useState<Notice | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    id: string; tool: string; input: Record<string, unknown>; description: string;
  } | null>(null);

  const [tools, setTools] = useState<ToolDef[]>([]);
  const [config, setConfig] = useState<EscarlataConfig | null>(null);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [directives, setDirectives] = useState<DirectiveItem[]>([]);
  const [vitalsProvider, setVitalsProvider] = useState<VitalsProvider>(() => localStorage.getItem('escarlata_vitals_provider') === 'openai' ? 'openai' : 'anthropic');
  const [vitalsByProvider, setVitalsByProvider] = useState<VitalsByProvider>({ anthropic: null, openai: null });
  const [vitalsErrors, setVitalsErrors] = useState<Partial<Record<VitalsProvider, string>>>({});
  const [vitalsCache, setVitalsCache] = useState<Partial<Record<VitalsProvider, { cached: boolean; updatedAt?: string }>>>({});
  const [usageStats, setUsageStats] = useState<UsageStatsDay[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string>('');
  // null hasta que el servidor manda su estado — evita migrar/sobrescribir antes de tiempo
  const [chatFolders, setChatFolders] = useState<ChatFolderState | null>(null);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    provider: 'ollama', model: 'qwen2.5:7b',
    link: { ollama: false, whisper: false, ngrok: false },
    runner: 'standby', queue: 0,
  });
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [localModelFiles, setLocalModelFiles] = useState<LocalModelFile[]>([]);
  const [modelsDir, setModelsDir] = useState('');
  const [modelsScanError, setModelsScanError] = useState<string>();
  const [providerAuthStatuses, setProviderAuthStatuses] = useState<Record<string, ProviderAuthStatus>>({});
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences | null>(null);
  const [heartbeatPaused, setHeartbeatPaused] = useState(false);
  const [localProfile, setLocalProfile] = useState<{id:string;displayName:string;deviceId:string;firebaseUid?:string|null;lastSyncAt?:string|null}|null>(null);
  const [syncSnapshot, setSyncSnapshot] = useState<any>(null);
  const [authState, setAuthState] = useState<{configured:boolean;username?:string;windowsHelloAvailable?:boolean;windowsHelloEnabled?:boolean;rememberSession?:boolean;unlocked:boolean}>({configured:false,unlocked:false});
  const [onboarding, setOnboarding] = useState<{completed:boolean;directivesFile?:string;modelProvider?:string;modelName?:string;configureMultiple?:boolean;vaultDirectory?:string;primaryUses?:string[];otherUse?:string}>({completed:false});
  const [defaultVaultDirectory, setDefaultVaultDirectory] = useState('Escarlata Vault');
  const [authError, setAuthError] = useState<string>();
  const [identifiedAccount, setIdentifiedAccount] = useState<{username:string;exists:boolean;windowsHelloEnabled:boolean;windowsHelloAvailable:boolean}|null>(null);
  const [route, setRoute] = useState<'login'|'setup'|'app'>(() => (location.hash.slice(1) as 'login'|'setup'|'app') || 'login');
  const navigate = useCallback((target:'login'|'setup'|'app') => { if(location.hash!==`#${target}`) location.hash=target; setRoute(target); }, []);

  useEffect(() => { const onHash=()=>{const target=location.hash.slice(1);setRoute(target==='setup'||target==='app'?target:'login');}; window.addEventListener('hashchange',onHash); return()=>window.removeEventListener('hashchange',onHash); }, []);

  // Chat como página real: mientras está abierto, bloquea el scroll del documento
  // (en móvil el CSS además oculta el contenido principal para evitar bugs visuales)
  useEffect(() => {
    // theme-color pinta la zona de la barra de estado / safe areas del navegador
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!chatPageOpen) {
      themeMeta?.setAttribute('content', '#050508');
      return;
    }
    document.documentElement.classList.add('chat-page-open');
    themeMeta?.setAttribute('content', '#0d0d12');
    return () => document.documentElement.classList.remove('chat-page-open');
  }, [chatPageOpen]);

  // Color cycle engine
  useEffect(() => {
    cycleHue();
    let id: number;
    function frame() { cycleHue(); id = requestAnimationFrame(frame); }
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, []);

  // Keyboard shortcuts (terminal no existe en la vista de chat)
  useEffect(() => {
    if (chatPageOpen || route !== 'app') return;
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '`' || e.key === 'Escape') {
        e.preventDefault();
        setTerminalOpen(v => !v);
      }
      if (e.key === ' ' && !isInput) {
        e.preventDefault();
        setTerminalOpen(true);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [chatPageOpen, route]);

  // Voice: mic push-to-talk -> server whisper STT; browser TTS for replies
  const sendRef = useRef<(data: unknown) => void>(() => {});
  const pulseHitRef = useRef(0);
  const voice = useVoice({
    onAudio: (base64, mime) => sendRef.current({ type: 'audio', data: base64, mime }),
    onBoundary: () => {
      pulseHitRef.current++;
      document.documentElement.style.setProperty('--pulse-hit', String(pulseHitRef.current));
    },
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    document.documentElement.style.setProperty('--activity', voice.status === 'speaking' ? '1' : '0');
  }, [voice.status]);

  const { send, connected, authenticated, authFailed } = useDesktopBridge({
    state: (msg: WsMessage) => {
      if (msg.tools) setTools(msg.tools as ToolDef[]);
      if (msg.config) setConfig(msg.config as EscarlataConfig);
      if (msg.facts) setFacts(msg.facts as MemoryFact[]);
      if (msg.memoryCandidates) setMemoryCandidates(msg.memoryCandidates as MemoryCandidate[]);
      if (msg.vaultFiles) setVaultFiles(msg.vaultFiles as VaultFile[]);
      if (msg.directives) setDirectives(msg.directives as DirectiveItem[]);
      if (msg.vitalsByProvider) setVitalsByProvider(msg.vitalsByProvider as VitalsByProvider);
      else if (msg.vitals) setVitalsByProvider(prev => ({ ...prev, anthropic: msg.vitals as VitalMetric[] }));
      if (msg.telemetryCache) {
        const cache = msg.telemetryCache as Partial<Record<VitalsProvider, string | undefined>>;
        setVitalsCache({
          anthropic: cache.anthropic ? { cached: true, updatedAt: cache.anthropic } : undefined,
          openai: cache.openai ? { cached: true, updatedAt: cache.openai } : undefined,
        });
      }
      if (msg.usageStats) setUsageStats(msg.usageStats as UsageStatsDay[]);
      if (msg.conversations) setConversations(msg.conversations as Conversation[]);
      if (msg.currentConvId) setCurrentConvId(msg.currentConvId as string);
      if (msg.chatFolders) setChatFolders(msg.chatFolders as ChatFolderState);
      if (msg.profile) setLocalProfile(msg.profile as typeof localProfile);
      if (msg.auth) setAuthState(msg.auth as typeof authState);
      if (msg.onboarding) setOnboarding(msg.onboarding as typeof onboarding);
      if (msg.defaultVaultDirectory) setDefaultVaultDirectory(msg.defaultVaultDirectory as string);
      if (msg.ollamaModels) setOllamaModels(msg.ollamaModels as OllamaModelInfo[]);
      if (msg.modelsDir) setModelsDir(msg.modelsDir as string);
      if (msg.provider || msg.model) {
        setSystemStatus(prev => ({
          ...prev,
          provider: (msg.provider as string) || prev.provider,
          model: (msg.model as string) || prev.model,
        }));
      }
      if (msg.history) setMessages((msg.history as { role: string; content: unknown }[]).map(h => ({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: h.role as 'user' | 'assistant',
        content: typeof h.content === 'string' ? h.content : Array.isArray(h.content) ? h.content.map((b: any) => b.text || '').filter(Boolean).join('\n') : String(h.content ?? ''),
        timestamp: new Date().toISOString(),
      })));
    },
    chat_folders: (msg: WsMessage) => {
      setChatFolders({
        folders: (msg.folders as ChatFolderState['folders']) || [],
        assign: (msg.assign as ChatFolderState['assign']) || {},
      });
    },
    conversations: (msg: WsMessage) => {
      if (msg.list) setConversations(msg.list as Conversation[]);
      if (msg.currentConvId) setCurrentConvId(msg.currentConvId as string);
    },
    sync_state: (msg: WsMessage) => { if (msg.profile) setLocalProfile(msg.profile as typeof localProfile); },
    sync_snapshot: (msg: WsMessage) => setSyncSnapshot(msg as any),
    auth_state: (msg: WsMessage) => setAuthState(msg as unknown as typeof authState),
    auth_result: (msg: WsMessage) => { if(msg.success){setAuthError(undefined);setAuthState(prev=>({...prev,unlocked:true,windowsHelloEnabled:msg.windowsHelloEnabled===undefined?prev.windowsHelloEnabled:Boolean(msg.windowsHelloEnabled)}));if(msg.profile)setLocalProfile(msg.profile as typeof localProfile);navigate(onboarding.completed?'app':'setup');} else setAuthError(String(msg.message||'No se pudo iniciar sesión.')); },
    local_account_identified: (msg: WsMessage) => setIdentifiedAccount({username:String(msg.username||''),exists:Boolean(msg.exists),windowsHelloEnabled:Boolean(msg.windowsHelloEnabled),windowsHelloAvailable:Boolean(msg.windowsHelloAvailable)}),
    onboarding_complete: (msg: WsMessage) => { setOnboarding((msg.setup as typeof onboarding) || {completed:true}); navigate('app'); },
    windows_hello_result: (msg: WsMessage) => setAuthError(msg.success?'Windows Hello verificado correctamente.':'Windows Hello no está disponible o fue cancelado.'),
    token: (msg: WsMessage) => {
      const token = msg.token as string;
      pulseHitRef.current++;
      document.documentElement.style.setProperty('--pulse-hit', String(pulseHitRef.current));
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming) {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + token };
          return updated;
        }
        return prev;
      });
    },
    response: (msg: WsMessage) => {
      const content = msg.content as string;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming) {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content, isStreaming: false };
          return updated;
        }
        return prev;
      });
      setStreamingId(null);
      window.speechSynthesis?.cancel();
      requestAnimationFrame(() => voiceRef.current.speak(content));
    },
    transcript: (msg: WsMessage) => {
      const text = msg.text as string;
      window.speechSynthesis?.cancel();
      voiceRef.current.onTranscript();
      setMessages(prev => [
        ...prev,
        { id: `msg-${Date.now()}`, role: 'user', content: text, timestamp: new Date().toISOString() },
        { id: `stream-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date().toISOString(), isStreaming: true },
      ]);
      setStreamingId(`stream-${Date.now()}`);
    },
    confirmation: (msg: WsMessage) => {
      setPendingConfirm({ id: msg.id as string, tool: msg.tool as string, input: msg.input as Record<string, unknown>, description: msg.description as string });
    },
    confirm_result: () => setPendingConfirm(null),
    memories: (msg: WsMessage) => {
      if (msg.facts) setFacts(msg.facts as MemoryFact[]);
    },
    memory_candidates: (msg: WsMessage) => {
      if (msg.candidates) setMemoryCandidates(msg.candidates as MemoryCandidate[]);
    },
    error: (msg: WsMessage) => {
      setMessages(prev => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: `⚠ Error: ${msg.message}`, timestamp: new Date().toISOString() }]);
      setStreamingId(null);
      setPendingConfirm(null);
      voiceRef.current.onError();
    },
    notices: (msg: WsMessage) => {
      if (msg.active) setNotices(msg.active as Notice[]);
      if (msg.all) setNotices(msg.all as Notice[]);
    },
    notice_dismissed: (msg: WsMessage) => {
      setNotices(prev => prev.filter(n => n.id !== (msg.id as string)));
    },
    desktop_preferences: (msg: WsMessage) => { if (msg.preferences) setDesktopPreferences(msg.preferences as DesktopPreferences); },
    notification_activated: (msg: WsMessage) => { const notice = notices.find(item => item.id === msg.id); if (notice) setOpenNotice(notice); },
    open_notification_center: () => { setChatPageOpen(true); },
    open_app_settings: () => setShowAppSettings(true),
    tray_new_chat: () => { setChatPageOpen(true); handleNewChat(); },
    tray_toggle_heartbeat: () => { const paused = !heartbeatPaused; setHeartbeatPaused(paused); send({ type: 'set_heartbeat', paused }); },
    vault_files: (msg: WsMessage) => {
      if (msg.files) setVaultFiles(msg.files as VaultFile[]);
    },
    directives: (msg: WsMessage) => {
      if (msg.items) setDirectives(msg.items as DirectiveItem[]);
    },
    vitals: (msg: WsMessage) => {
      const provider = (msg.provider === 'openai' ? 'openai' : 'anthropic') as VitalsProvider;
      if (msg.metrics) setVitalsByProvider(prev => ({ ...prev, [provider]: msg.metrics as VitalMetric[] }));
      setVitalsErrors(prev => ({ ...prev, [provider]: typeof msg.error === 'string' ? msg.error : undefined }));
      setVitalsCache(prev => ({ ...prev, [provider]: { cached: Boolean(msg.cached), updatedAt: typeof msg.updatedAt === 'string' ? msg.updatedAt : undefined } }));
    },
    usage_stats: (msg: WsMessage) => {
      if (msg.days) setUsageStats(msg.days as UsageStatsDay[]);
    },
    pong: () => {},
    ollama_models: (msg: WsMessage) => {
      if (msg.models) setOllamaModels(msg.models as OllamaModelInfo[]);
    },
    models_dir_result: (msg: WsMessage) => {
      if (msg.files) setLocalModelFiles(msg.files as LocalModelFile[]);
      if (msg.directory) setModelsDir(msg.directory as string);
      setModelsScanError(typeof msg.error === 'string' ? msg.error : undefined);
    },
    system_status: (msg: WsMessage) => {
      setSystemStatus({
        provider: msg.provider as string,
        model: msg.model as string,
        link: msg.link as LinkStatus,
        runner: msg.runner as 'standby' | 'processing' | 'tool_call',
        queue: msg.queue as number,
      });
    },
    provider_updated: (msg: WsMessage) => {
      setSystemStatus(prev => ({
        ...prev,
        provider: msg.provider as string,
        model: msg.model as string,
      }));
      if (msg.authMethod) {
        setConfig(prev => prev ? {
          ...prev,
          modelProvider: msg.provider as string,
          modelName: msg.model as string,
          authMethods: { ...prev.authMethods, [msg.provider as string]: msg.authMethod as AuthMethod },
        } : prev);
      }
      setShowModelConfig(false);
    },
    provider_auth_status: (msg: WsMessage) => {
      const status = msg as unknown as ProviderAuthStatus;
      setProviderAuthStatuses(prev => ({ ...prev, [status.provider]: status }));
    },
    provider_auth_started: (msg: WsMessage) => {
      const status = msg as unknown as ProviderAuthStatus;
      setProviderAuthStatuses(prev => ({ ...prev, [status.provider]: status }));
      if (status.authUrl) window.open(status.authUrl, '_blank', 'noopener,noreferrer');
    },
    provider_auth_error: (msg: WsMessage) => {
      const provider = String(msg.provider || '');
      setProviderAuthStatuses(prev => ({
        ...prev,
        [provider]: { provider: provider as 'anthropic' | 'openai', method: 'oauth_local', state: 'error', message: String(msg.message || 'OAuth error') },
      }));
    },
    tool_event: (msg: WsMessage) => {
      const sub = msg.sub as string;
      const name = msg.name as string;
      if (sub === 'tool_start') {
        setToolActivities(prev => [...prev, { id: `tool-${Date.now()}`, name, status: 'running', input: msg.input as Record<string, unknown> }]);
      } else if (sub === 'tool_result') {
        setToolActivities(prev => {
          const idx = prev.map(a => a.name).lastIndexOf(name);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], status: 'done', result: msg.result as string };
            // Auto-dismiss the finished card after the countdown
            const doneId = updated[idx].id;
            setTimeout(() => {
              setToolActivities(cur => cur.filter(a => a.id !== doneId));
            }, TOOL_NOTICE_MS);
            return updated;
          }
          return prev;
        });
      }
    },
    history_cleared: () => {
      setMessages([]);
      setStreamingId(null);
    },
    greeting: (msg: WsMessage) => {
      const content = msg.content as string;
      setMessages(prev => [...prev, { id: `greet-${Date.now()}`, role: 'assistant', content, timestamp: new Date().toISOString() }]);
    },
  });

  useEffect(() => {
    if (connected) send({ type: 'get_vitals', provider: vitalsProvider });
  }, [connected, send, vitalsProvider]);

  useEffect(() => {
    const refreshTelemetry = () => {
      send({ type: 'get_vitals', provider: 'anthropic' });
      send({ type: 'get_vitals', provider: 'openai' });
    };
    window.addEventListener('online', refreshTelemetry);
    return () => window.removeEventListener('online', refreshTelemetry);
  }, [send]);

  useEffect(() => { sendRef.current = send; }, [send]);

  useEffect(() => { if (connected) send({ type: 'get_desktop_preferences' }); }, [connected, send]);

  const wsDownRef = useRef(false);
  useEffect(() => { wsDownRef.current = !connected; }, [connected]);

  // Notices nuevos: TTS para importantes. Las alertas del sistema las gestiona
  // Electron en el proceso principal, incluso si esta ventana está oculta.
  const seenNoticesRef = useRef<Set<string>>(new Set());
  const noticesInitRef = useRef(false);
  useEffect(() => {
    const active = notices.filter(n => !n.dismissed);
    if (!noticesInitRef.current) {
      // primer estado tras conectar: lo histórico no dispara alertas
      noticesInitRef.current = true;
      active.forEach(n => seenNoticesRef.current.add(n.id));
      return;
    }
    for (const n of active) {
      if (seenNoticesRef.current.has(n.id)) continue;
      seenNoticesRef.current.add(n.id);
      const title = cleanNoticeTitle(n.title);
      if (n.severity === 'important' && voiceRef.current.ttsEnabled) {
        voiceRef.current.speak(title);
      }
    }
  }, [notices]);

  // Conexión caída a mitad de respuesta: liberar el estado de streaming
  // (si no, el input queda bloqueado para siempre esperando un 'response' que no llegará)
  useEffect(() => {
    if (connected) return;
    setStreamingId(null);
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.isStreaming) {
        const updated = [...prev];
        updated[updated.length - 1] = { ...last, isStreaming: false, content: (last.content || '') + (last.content ? '\n\n' : '') + '*[conexión perdida]*' };
        return updated;
      }
      return prev;
    });
  }, [connected]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !sendRef.current) return;
    if (wsDownRef.current) return; // sin conexión: no perder el mensaje en el vacío
    window.speechSynthesis?.cancel();
    setMessages(prev => [
      ...prev,
      { id: `msg-${Date.now()}`, role: 'user', content: text, timestamp: new Date().toISOString() },
      { id: `stream-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date().toISOString(), isStreaming: true },
    ]);
    setStreamingId(`stream-${Date.now()}`);
    send({ type: 'message', content: text });
  }, [send]);

  const handleConfirm = useCallback((decision: 'approved' | 'denied') => {
    if (pendingConfirm) {
      send({ type: 'confirm', id: pendingConfirm.id, decision });
    }
  }, [pendingConfirm, send]);

  const handleNewChat = useCallback(() => {
    send({ type: 'new_chat' });
  }, [send]);

  const handleSwitchChat = useCallback((id: string) => {
    send({ type: 'switch_chat', id });
  }, [send]);

  const handleDeleteChat = useCallback((id: string) => {
    send({ type: 'delete_conversation', id });
  }, [send]);

  const handleRenameChat = useCallback((id: string, title: string) => {
    send({ type: 'rename_conversation', id, title });
  }, [send]);

  // Optimista local + persistencia en servidor (que reenvía a todos los dispositivos)
  const handleChatFoldersChange = useCallback((next: ChatFolderState) => {
    setChatFolders(next);
    send({ type: 'set_chat_folders', folders: next.folders, assign: next.assign });
  }, [send]);

  const handleEditMessage = useCallback((_messageId: string, _newContent: string) => {
    // Update the message locally and send to server
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === _messageId);
      if (idx === -1) return prev;
      const updated = prev.slice(0, idx);
      // Remove all messages after the edited one (the assistant response)
      setStreamingId(`stream-${Date.now()}`);
      updated.push({
        id: `msg-${Date.now()}`,
        role: 'user',
        content: _newContent,
        timestamp: new Date().toISOString(),
      });
      updated.push({
        id: `stream-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      });
      return updated;
    });
    send({ type: 'edit_message', messageId: _messageId, content: _newContent });
  }, [send]);

  const handleSetProvider = useCallback((provider: string, model: string, authMethod: AuthMethod, apiKey?: string) => {
    send({ type: 'set_provider', provider, model, authMethod, apiKey });
  }, [send]);

  const handleRequestProviderAuth = useCallback((provider: 'anthropic' | 'openai') => {
    send({ type: 'get_provider_auth', provider });
  }, [send]);

  const handleStartProviderAuth = useCallback((provider: 'anthropic' | 'openai') => {
    send({ type: 'start_provider_auth', provider });
  }, [send]);

  const handleCancelProviderAuth = useCallback((provider: 'anthropic' | 'openai') => {
    send({ type: 'cancel_provider_auth', provider });
  }, [send]);

  const handleRefreshOllamaModels = useCallback(() => {
    send({ type: 'get_ollama_models' });
  }, [send]);

  const handleScanModelsDir = useCallback((dir: string) => {
    send({ type: 'scan_models_dir', directory: dir });
  }, [send]);

  const handleChooseModelsDir = useCallback(async () => {
    const directory = await window.escarlataDesktop?.command({ type: 'choose_models_directory' });
    if (typeof directory !== 'string' || !directory) return;
    setModelsDir(directory);
    send({ type: 'scan_models_dir', directory });
  }, [send]);

  const handleStopStream = useCallback(() => {
    send({ type: 'abort' });
    window.speechSynthesis?.cancel();
    setStreamingId(null);
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.isStreaming) {
        const updated = [...prev];
        updated[updated.length - 1] = { ...last, isStreaming: false, content: last.content + '\n\n*[generation stopped]*' };
        return updated;
      }
      return prev;
    });
  }, [send]);

  const activeNotices = notices.filter(n => !n.dismissed);
  const posList: ('top-left' | 'top-right' | 'bottom-left' | 'bottom-right')[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

  const handleClearAll = useCallback(() => {
    activeNotices.forEach(n => send({ type: 'dismiss_notice', id: n.id }));
  }, [activeNotices, send]);

  const handleSidebarResize = useCallback((x: number) => {
    const w = Math.min(Math.max(x, 240), 600);
    document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
  }, []);

  if (!connected || !authenticated || authFailed) {
    return (
      <DesktopWindowFrame><div className="token-gate">
        <div className="hud-panel token-gate-panel">
          <div className="hud-corner tl" /><div className="hud-corner tr" />
          <div className="hud-corner bl" /><div className="hud-corner br" />
          <div className="token-gate-title">E.S.C.A.R.L.A.T.A</div>
          <div className="token-gate-sub">
            {authFailed ? 'NO SE PUDO ABRIR EL NÚCLEO LOCAL' : 'INICIANDO PERFIL LOCAL…'}
          </div>
          <div className="token-gate-sub">La sesión se protege con tu cuenta de Windows.</div>
        </div>
      </div></DesktopWindowFrame>
    );
  }

  if (route === 'login' || !authState.unlocked) return <DesktopWindowFrame><LoginPage profile={localProfile} auth={authState} identified={identifiedAccount} error={authError} onSetup={(username,password,enableWindowsHello,rememberSession)=>send({type:'setup_local_account',username,password,enableWindowsHello,rememberSession})} onLogin={(username,password,rememberSession)=>send({type:'login_local',username,password,rememberSession})} onIdentify={username=>{setAuthError(undefined);setIdentifiedAccount(null);send({type:'identify_local_account',username});}} onGoogle={uid=>send({type:'sync_link',uid})} onHello={(username,rememberSession)=>send({type:'login_windows_hello',username,rememberSession})}/></DesktopWindowFrame>;
  if (route === 'setup' || !onboarding.completed || !onboarding.directivesFile) return <DesktopWindowFrame><OnboardingWizard defaultVault={defaultVaultDirectory} resumeFromDirectives={Boolean(onboarding.completed&&!onboarding.directivesFile)} existingSetup={onboarding} onPickVault={async()=>{const result=await window.escarlataDesktop?.command({type:'choose_vault_directory'} as never);return typeof result==='string'?result:null;}} onPickDirectives={async()=>{const result=await window.escarlataDesktop?.command({type:'choose_directives_file'} as never);return typeof result==='string'?result:null;}} onComplete={data=>send({type:'complete_onboarding',...data})}/></DesktopWindowFrame>;

  // Chat es una vista dedicada: reemplaza a la página principal en vez de superponerse.
  // Sin capa fija encima no hay scroll de fondo ni saltos al abrir el teclado en móvil.
  if (chatPageOpen) {
    return (
      <DesktopWindowFrame>
      <ErrorBoundary>
        <ChatPage
          messages={messages}
          onSend={sendMessage}
          streamingId={streamingId}
          pendingConfirm={pendingConfirm}
          onConfirm={handleConfirm}
          onClose={() => setChatPageOpen(false)}
          onNewChat={handleNewChat}
          conversations={conversations}
          currentConvId={currentConvId}
          onSwitchChat={handleSwitchChat}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
          onStopStream={handleStopStream}
          toolActivities={toolActivities}
          onEditMessage={handleEditMessage}
          model={systemStatus.model}
          voice={voice}
          folderState={chatFolders ?? undefined}
          onFolderStateChange={handleChatFoldersChange}
          onOpenModelConfig={() => setShowModelConfig(true)}
          connected={connected}
          notices={notices}
          onDismissNotice={(id) => send({ type: 'dismiss_notice', id })}
        />
      </ErrorBoundary>
      {showModelConfig && (
        <ModelConfigPanel
          currentProvider={systemStatus.provider}
          currentModel={systemStatus.model}
          authMethods={config?.authMethods || {}}
          authStatuses={providerAuthStatuses}
          ollamaModels={ollamaModels}
          localModelFiles={localModelFiles}
          modelsDir={modelsDir}
          scanError={modelsScanError}
          onRefreshOllama={handleRefreshOllamaModels}
          onScanDir={handleScanModelsDir}
          onSetModelsDir={setModelsDir}
          onChooseModelsDir={handleChooseModelsDir}
          onRequestAuthStatus={handleRequestProviderAuth}
          onStartAuth={handleStartProviderAuth}
          onCancelAuth={handleCancelProviderAuth}
          onApply={handleSetProvider}
          onCancel={() => setShowModelConfig(false)}
        />
      )}
      </DesktopWindowFrame>
    );
  }

  return (
    <DesktopWindowFrame><div className="app-container">
      <div className="mobile-logo">
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '0.25em', color: 'var(--accent-bright)', lineHeight: 1.2 }}>
          E.S.C.A.R.L.A.T.A
        </div>
        <div style={{ fontSize: 8, letterSpacing: '0.12em', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2 }}>
          ENTIDAD SINTÉTICA DE COMANDO AUTÓNOMO<br />
          CON RAZONAMIENTO LÓGICO ASINCRÓNICO Y TOMA AUTÓNOMA DE DECISIONES
        </div>
      </div>
      <div className="main-content">
        <ResizeHandle onResize={handleSidebarResize} />
        <SidebarLeft
          vaultFiles={vaultFiles}
          facts={facts}
          directives={directives}
          vitals={vitalsByProvider[vitalsProvider] || []}
          vitalsProvider={vitalsProvider}
          vitalsError={vitalsErrors[vitalsProvider]}
          vitalsCached={vitalsCache[vitalsProvider]?.cached}
          vitalsUpdatedAt={vitalsCache[vitalsProvider]?.updatedAt}
          onVitalsProviderChange={(provider) => {
            setVitalsProvider(provider);
            localStorage.setItem('escarlata_vitals_provider', provider);
          }}
          onDeleteMemory={(id) => send({ type: 'delete_memory', id })}
          memoryCandidates={memoryCandidates}
          onReviewCandidate={(id, decision) => send({ type: 'review_memory_candidate', id, decision })}
          onOpenChat={() => setChatPageOpen(true)}
          onOpenProviders={() => setShowModelConfig(true)}
          onOpenSync={() => setShowSyncSettings(true)}
          onOpenActivity={() => setTerminalOpen(true)}
          onOpenAppSettings={() => setShowAppSettings(true)}
        />

        <div className="center-column">
          <div className="graph-zone">
            <div className="center-header">
              <StatusRow
                noticeCount={activeNotices.length}
                provider={systemStatus.provider}
                model={systemStatus.model}
                link={systemStatus.link}
                runner={systemStatus.runner}
                queue={systemStatus.queue}
                onOpenModelConfig={() => setShowModelConfig(true)}
                onOpenSync={() => setShowSyncSettings(true)}
              />
              {activeNotices.length > 0 && (
                <button className="clear-all-btn" onClick={handleClearAll}>
                  CLEAR ALL <span className="clear-all-count">×{activeNotices.length}</span>
                </button>
              )}
            </div>
            <ParticleSphere />
            <div className="hero-metric-wrapper">
              <HeroMetric vaultFiles={vaultFiles} facts={facts} tools={tools} />
            </div>
          </div>
          <div className="notices-container">
            {activeNotices.slice(0, 4).map((n, i) => (
              <FloatingNotice key={n.id} title={n.title} subtitle={n.body} position={posList[i] || 'bottom-left'} source={n.source} createdAt={n.createdAt} onOpen={() => setOpenNotice(n)} />
            ))}
          </div>
        </div>

        <SidebarRight
          tools={tools}
          usageStats={usageStats}
          voice={voice}
          onOpenChat={() => setChatPageOpen(true)}
          onOpenTerminal={() => setTerminalOpen(true)}
          onOpenModelConfig={() => setShowModelConfig(true)}
          notices={notices}
          activities={toolActivities}
          onCommand={(text) => { setChatPageOpen(true); sendMessage(text); }}
        />
      </div>

      <button
        className="mobile-chat-fab"
        onClick={() => setChatPageOpen(true)}
        aria-label="Abrir chat"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>

      <PerspectiveGrid />
      <ErrorBoundary>
        <TerminalOverlay
          messages={messages}
          onSend={sendMessage}
          streamingId={streamingId}
          pendingConfirm={pendingConfirm}
          onConfirm={handleConfirm}
          isOpen={terminalOpen}
          onClose={() => setTerminalOpen(false)}
          onNewChat={handleNewChat}
          conversations={conversations}
          currentConvId={currentConvId}
          onSwitchChat={handleSwitchChat}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
          onStopStream={handleStopStream}
          toolActivities={toolActivities}
          onEditMessage={handleEditMessage}
        />
      </ErrorBoundary>

      {showSyncSettings && <SyncSettings profile={localProfile} snapshot={syncSnapshot} onCommand={send} onClose={() => setShowSyncSettings(false)} />}
      {showAppSettings && <AppSettings profile={localProfile} vaultDirectory={onboarding.vaultDirectory} preferences={desktopPreferences} windowsHelloAvailable={Boolean(authState.windowsHelloAvailable)} windowsHelloEnabled={Boolean(authState.windowsHelloEnabled)} rememberSession={Boolean(authState.rememberSession)} onSetWindowsHello={enabled => send({ type: 'set_windows_hello', enabled })} onSetRememberSession={enabled => send({ type: 'set_remember_session', enabled })} onSavePreferences={preferences => send({ type: 'set_desktop_preferences', preferences })} onTestNotification={() => send({ type: 'test_desktop_notification' })} onClose={() => setShowAppSettings(false)} onOpenProviders={() => setShowModelConfig(true)} onOpenSync={() => setShowSyncSettings(true)} />}

      {openNotice && (
        <div className="notice-detail-backdrop" onClick={() => setOpenNotice(null)}>
          <div className="notice-detail-panel hud-panel" onClick={e => e.stopPropagation()}>
            <div className="hud-corner tl" /><div className="hud-corner tr" />
            <div className="hud-corner bl" /><div className="hud-corner br" />
            <div className="notice-detail-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <NoticeIcon source={openNotice.source} createdAt={openNotice.createdAt} size={14} />
                <span className="label" style={{ color: 'var(--accent-text)' }}>{cleanNoticeTitle(openNotice.title)}</span>
              </div>
              <button className="notice-detail-close" onClick={() => setOpenNotice(null)}>×</button>
            </div>
            <div className="notice-detail-meta label-sm">
              {openNotice.source} · {new Date(openNotice.createdAt).toLocaleString()}
            </div>
            <div className="notice-detail-body">{openNotice.body}</div>
            {openNotice.actions && openNotice.actions.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {openNotice.actions.map(a => (
                  <button
                    key={a.label}
                    className="chat-mini-btn primary"
                    onClick={() => {
                      setOpenNotice(null);
                      setChatPageOpen(true);
                      sendMessage(a.command);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showModelConfig && (
        <ModelConfigPanel
          currentProvider={systemStatus.provider}
          currentModel={systemStatus.model}
          authMethods={config?.authMethods || {}}
          authStatuses={providerAuthStatuses}
          ollamaModels={ollamaModels}
          localModelFiles={localModelFiles}
          modelsDir={modelsDir}
          scanError={modelsScanError}
          onRefreshOllama={handleRefreshOllamaModels}
          onScanDir={handleScanModelsDir}
          onSetModelsDir={setModelsDir}
          onChooseModelsDir={handleChooseModelsDir}
          onRequestAuthStatus={handleRequestProviderAuth}
          onStartAuth={handleStartProviderAuth}
          onCancelAuth={handleCancelProviderAuth}
          onApply={handleSetProvider}
          onCancel={() => setShowModelConfig(false)}
        />
      )}
    </div></DesktopWindowFrame>
  );
}
