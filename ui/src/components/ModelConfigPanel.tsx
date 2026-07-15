import { useState, useEffect, useRef } from 'react';
import type { AuthMethod, OllamaModelInfo, LocalModelFile, ProviderAuthStatus } from '../types';

interface ProviderGroup {
  id: string;
  label: string;
  icon: string;
  needsKey: boolean;
  keyPlaceholder: string;
  presets: { model: string; label: string }[];
}

const GROUPS: ProviderGroup[] = [
  {
    id: 'ollama', label: 'Local (Ollama)', icon: '◇', needsKey: false, keyPlaceholder: '',
    presets: [
      { model: 'llama3.1', label: 'llama3.1' },
      { model: 'llama3.2:3b', label: 'llama3.2:3b' },
      { model: 'mistral', label: 'mistral' },
      { model: 'phi3:mini', label: 'phi3:mini' },
    ],
  },
  {
    id: 'anthropic', label: 'Anthropic', icon: '○', needsKey: true, keyPlaceholder: 'sk-ant-...',
    presets: [
      { model: 'claude-sonnet-5-20260512', label: 'Sonnet 5' },
      { model: 'claude-opus-4-8-20260514', label: 'Opus 4.8' },
      { model: 'claude-fable-5-20260506', label: 'Fable 5' },
      { model: 'claude-haiku-4-5-20260506', label: 'Haiku 4.5' },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', icon: '●', needsKey: true, keyPlaceholder: 'sk-proj-...',
    presets: [
      { model: 'gpt-5.4', label: 'GPT-5.4' },
      { model: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { model: 'gpt-5', label: 'GPT-5 (API)' },
    ],
  },
  {
    id: 'openrouter', label: 'OpenRouter', icon: '▽', needsKey: true, keyPlaceholder: 'sk-or-v1-...',
    presets: [
      { model: 'cohere/north-mini-code:free', label: 'North Mini Code (free)' },
      { model: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra (free)' },
      { model: 'poolside/laguna-m.1:free', label: 'Laguna M.1 (free)' },
      { model: 'meta-llama/llama-4-maverick:free', label: 'Llama 4 Maverick (free)' },
    ],
  },
  {
    id: 'nvidia', label: 'NVIDIA', icon: '□', needsKey: true, keyPlaceholder: 'nvapi-...',
    presets: [
      { model: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B' },
      { model: 'mistralai/mistral-7b-instruct-v0.3', label: 'Mistral 7B v0.3' },
      { model: 'google/gemma-2-27b-it', label: 'Gemma 2 27B' },
      { model: 'nvidia/nemotron-4-340b-instruct', label: 'Nemotron 4 340B' },
    ],
  },
];

interface ModelConfigPanelProps {
  currentProvider: string;
  currentModel: string;
  authMethods: Record<string, AuthMethod>;
  authStatuses: Record<string, ProviderAuthStatus>;
  ollamaModels: OllamaModelInfo[];
  localModelFiles: LocalModelFile[];
  modelsDir: string;
  scanError?: string;
  onRefreshOllama: () => void;
  onScanDir: (dir: string) => void;
  onSetModelsDir: (dir: string) => void;
  onChooseModelsDir: () => void;
  onRequestAuthStatus: (provider: 'anthropic' | 'openai') => void;
  onStartAuth: (provider: 'anthropic' | 'openai') => void;
  onCancelAuth: (provider: 'anthropic' | 'openai') => void;
  onApply: (provider: string, model: string, authMethod: AuthMethod, apiKey?: string) => void;
  onCancel: () => void;
}

export function ModelConfigPanel({ currentProvider, currentModel, authMethods, authStatuses, ollamaModels, localModelFiles, modelsDir, scanError, onRefreshOllama, onScanDir, onSetModelsDir, onChooseModelsDir, onRequestAuthStatus, onStartAuth, onCancelAuth, onApply, onCancel }: ModelConfigPanelProps) {
  const [selectedGroup, setSelectedGroup] = useState(currentProvider);
  const [authMethod, setAuthMethod] = useState<AuthMethod>(authMethods[currentProvider] || 'api_key');
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState('');
  // A key exists in this form only until Apply. It is never retained by the renderer.
  const [apiKey, setApiKey] = useState('');
  const [dirInput, setDirInput] = useState(modelsDir);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'done'>('idle');
  const scanRef = useRef(false);

  useEffect(() => {
    if (scanRef.current) {
      scanRef.current = false;
      setScanStatus('done');
    }
  }, [localModelFiles]);

  useEffect(() => {
    if (scanStatus === 'scanning') {
      const t = setTimeout(() => setScanStatus('done'), 5000);
      return () => clearTimeout(t);
    }
  }, [scanStatus]);

  useEffect(() => {
    if (selectedGroup === 'ollama') onRefreshOllama();
  }, [selectedGroup, onRefreshOllama]);

  useEffect(() => {
    if (authMethod === 'oauth_local' && (selectedGroup === 'anthropic' || selectedGroup === 'openai')) {
      onRequestAuthStatus(selectedGroup);
    }
  }, [authMethod, selectedGroup, onRequestAuthStatus]);

  const group = GROUPS.find(g => g.id === selectedGroup) || GROUPS[0];
  const effectiveModel = customModel.trim() || selectedModel || (selectedGroup === currentProvider ? currentModel : '');
  const hasValidModel = effectiveModel.length > 0;
  const activeKey = `${currentProvider}/${currentModel}`;
  const pendingKey = `${selectedGroup}/${effectiveModel}`;
  const supportsOAuth = selectedGroup === 'anthropic' || selectedGroup === 'openai';
  const needsKey = group.needsKey && authMethod === 'api_key';
  const oauthStatus = authStatuses[selectedGroup];
  const oauthReady = authMethod !== 'oauth_local' || oauthStatus?.state === 'connected';
  const hasKey = needsKey
    ? apiKey.length > 0 || (selectedGroup === currentProvider && (authMethods[selectedGroup] || 'api_key') === 'api_key')
    : true;
  const modelChanged = pendingKey !== activeKey;
  const authChanged = authMethod !== (authMethods[selectedGroup] || 'api_key');
  const keyAdded = needsKey && apiKey.length > 0;
  const canApply = hasValidModel && hasKey && oauthReady && (modelChanged || authChanged || customModel || keyAdded);

  function switchGroup(gid: string) {
    setSelectedGroup(gid);
    setAuthMethod(authMethods[gid] || 'api_key');
    setSelectedModel(null);
    setCustomModel('');
  }

  function selectModel(model: string) {
    setSelectedModel(model);
    setCustomModel('');
  }

  const detectedNames = new Set(ollamaModels.map(m => m.name));
  interface LocalModelEntry { name: string; size: number; modelName?: string }
  const allLocalModels: LocalModelEntry[] = [...ollamaModels.map(m => ({ name: m.name, size: m.size })), ...localModelFiles.map(f => ({ name: f.name, size: f.size, modelName: f.modelName }))];
  // Deduplicate by name
  const seen = new Set<string>();
  const dedupedLocal = allLocalModels.filter(m => { const k = m.name; if (seen.has(k)) return false; seen.add(k); return true; });

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        fontFamily: 'var(--font-mono, monospace)', fontSize: 12,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-overlay)', border: '1px solid var(--accent-line)',
          backdropFilter: 'blur(16px)',
          padding: 'clamp(14px, 2.5vw, 28px)', minWidth: 380, maxWidth: 480,
          maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div style={{ color: 'var(--accent-bright)', letterSpacing: '0.15em', marginBottom: 14, fontSize: 13 }}>
          PROVIDER CONFIG
        </div>

        {/* Provider tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {GROUPS.map(g => (
            <button
              key={g.id}
              onClick={() => switchGroup(g.id)}
              className="pill-btn"
              style={{
                fontSize: 9,
                background: selectedGroup === g.id ? 'var(--accent-glow)' : 'transparent',
                borderColor: selectedGroup === g.id ? 'var(--accent)' : 'var(--accent-line)',
                color: selectedGroup === g.id ? 'var(--accent-bright)' : 'var(--text-secondary)',
              }}
            >
              {g.icon} {g.label}
            </button>
          ))}
        </div>

        {/* Preset models */}
        <div style={{ marginBottom: 8 }}>
          {group.presets.map(p => {
            const isCurrent = selectedGroup === currentProvider && p.model === currentModel && !customModel && selectedModel === null;
            const isSelected = p.model === selectedModel;
            const isDetected = selectedGroup === 'ollama' && detectedNames.has(p.model);
            return (
              <div
                key={p.model}
                onClick={() => selectModel(p.model)}
                style={{
                  padding: '5px 8px', cursor: 'pointer',
                  background: isSelected ? 'var(--accent-glow)' : 'transparent',
                  border: isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                  color: isCurrent ? 'var(--accent-bright)' : 'var(--text-primary)',
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1, fontSize: 11,
                }}
              >
                <span>{p.label}</span>
                {isDetected && <span style={{ fontSize: 8, color: 'var(--accent-text)', marginLeft: 4 }}>✓</span>}
                {isCurrent && <span style={{ marginLeft: 'auto', color: 'var(--accent-text)', fontSize: 9 }}>ACTIVE</span>}
              </div>
            );
          })}
        </div>

        {/* Custom model input */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 3 }}>
            Custom model ID
          </div>
          <input
            type="text"
            placeholder={group.id === 'openrouter' ? 'anthropic/claude-sonnet-5' : group.id === 'nvidia' ? 'meta/llama-3.1-8b-instruct' : 'my-model:latest'}
            value={customModel}
            onChange={e => setCustomModel(e.target.value)}
            style={{
              width: '100%', padding: '5px 8px',
              background: 'rgba(0,0,0,0.4)', border: '1px solid var(--accent-dim)',
              color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 11,
              outline: 'none',
            }}
          />
        </div>

        {supportsOAuth && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 5 }}>
              Authentication
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {(['api_key', 'oauth_local'] as AuthMethod[]).map(method => (
                <button
                  key={method}
                  className="pill-btn"
                  onClick={() => setAuthMethod(method)}
                  style={{
                    fontSize: 9,
                    background: authMethod === method ? 'var(--accent-glow)' : 'transparent',
                    borderColor: authMethod === method ? 'var(--accent)' : 'var(--accent-line)',
                  }}
                >
                  {method === 'api_key' ? 'API KEY' : 'OAUTH LOCAL'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Detected Ollama models + local dir files */}
        {selectedGroup === 'ollama' && dedupedLocal.length > 0 && (
          <div style={{ marginBottom: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--accent-text)', marginBottom: 4 }}>
              ◇ Installed locally
            </div>
            {dedupedLocal.map(m => {
              const selectableName = m.modelName || (detectedNames.has(m.name) ? m.name : undefined);
              const selectable = Boolean(selectableName);
              const isCurrent = selectedGroup === currentProvider && selectableName === currentModel && !customModel && selectedModel === null;
              const isSelected = selectableName === selectedModel;
              const sizeGb = (m.size / 1e9).toFixed(1);
              const shortName = m.modelName || (m.name.startsWith('sha256-') ? m.name.slice(0, 12) + '…' : m.name);
              return (
                <div
                  key={m.name}
                  onClick={() => { if (selectableName) selectModel(selectableName); }}
                  style={{
                    padding: '5px 8px', cursor: selectable ? 'pointer' : 'default', opacity: selectable ? 1 : 0.65,
                    background: isSelected ? 'var(--accent-glow)' : 'transparent',
                    border: isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                    color: isCurrent ? 'var(--accent-bright)' : 'var(--text-primary)',
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1, fontSize: 11,
                  }}
                >
                  <span style={{ color: 'var(--accent-dim)' }}>◇</span>
                  <span>{shortName}</span>
                  {m.modelName && <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>({m.name.slice(0, 8)}…)</span>}
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 9 }}>{sizeGb}GB</span>
                  {isCurrent && <span style={{ color: 'var(--accent-text)', fontSize: 9, marginLeft: 4 }}>ACTIVE</span>}
                  {!selectable && <span style={{ color: 'var(--text-muted)', fontSize: 8, marginLeft: 4 }}>IMPORT FIRST</span>}
                </div>
              );
            })}
          </div>
        )}

        {selectedGroup === 'ollama' && dedupedLocal.length === 0 && (
          <div style={{ marginBottom: 10, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No local models detected — Ollama may not be running
          </div>
        )}

        {/* Scan models directory */}
        {selectedGroup === 'ollama' && (
          <div style={{ marginBottom: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 3 }}>
              Scan directory for model files
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                placeholder="C:\\Models"
                value={dirInput}
                onChange={e => { setDirInput(e.target.value); onSetModelsDir(e.target.value); }}
                style={{
                  flex: 1, padding: '5px 8px',
                  background: 'rgba(0,0,0,0.4)', border: '1px solid var(--accent-dim)',
                  color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 11,
                  outline: 'none',
                }}
              />
              <button
                className="pill-btn"
                onClick={() => {
                  setScanStatus('scanning');
                  scanRef.current = true;
                  onScanDir(dirInput.trim());
                }}
                style={{ fontSize: 9, flexShrink: 0, opacity: scanStatus === 'scanning' || !dirInput.trim() ? 0.5 : 1 }}
                disabled={scanStatus === 'scanning' || !dirInput.trim()}
              >
                {scanStatus === 'scanning' ? '···' : 'SCAN'}
              </button>
              <button className="pill-btn" onClick={onChooseModelsDir} style={{ fontSize: 9, flexShrink: 0 }} title="Elegir carpeta">
                BROWSE
              </button>
            </div>
            {scanError && <div style={{ fontSize: 9, color: '#ff8c8c', marginTop: 4 }}>{scanError}</div>}
            {scanStatus === 'done' && (
              <div style={{ fontSize: 9, color: 'var(--accent-text)', marginTop: 4 }}>
                ✓ Found {localModelFiles.length} file{(localModelFiles.length !== 1 ? 's' : '')}
              </div>
            )}
            {scanStatus === 'scanning' && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                Scanning...
              </div>
            )}
          </div>
        )}

        {/* API key input (per-provider) */}
        {group.needsKey && (
          authMethod === 'api_key' &&
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 3 }}>
              {group.label} API Key
            </div>
            <input
              type="password"
              placeholder={group.keyPlaceholder}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{
                width: '100%', padding: '5px 8px',
                background: 'rgba(0,0,0,0.4)', border: '1px solid var(--accent-dim)',
                color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 11,
                outline: 'none',
              }}
            />
          </div>
        )}

        {supportsOAuth && authMethod === 'oauth_local' && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 10, color: oauthReady ? 'var(--accent-text)' : 'var(--text-muted)', marginBottom: 7 }}>
              {oauthStatus?.state === 'connected' ? '✓ Conectado'
                : oauthStatus?.state === 'connecting' ? 'Conectando…'
                  : oauthStatus?.state === 'unavailable' ? 'No disponible'
                    : oauthStatus?.state === 'expired' ? 'Sesión expirada'
                      : oauthStatus?.state === 'error' ? 'Error de conexión'
                        : 'Sin conexión OAuth'}
            </div>
            {oauthStatus?.message && oauthStatus.state !== 'connected' && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 7, lineHeight: 1.4 }}>{oauthStatus.message}</div>
            )}
            {oauthStatus?.authUrl && (
              <a href={oauthStatus.authUrl} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 9, color: 'var(--accent-text)', marginBottom: 7 }}>
                Abrir página de acceso
              </a>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="pill-btn"
                onClick={() => onStartAuth(selectedGroup as 'anthropic' | 'openai')}
                disabled={oauthStatus?.state === 'connecting'}
                style={{ fontSize: 9 }}
              >
                {oauthStatus?.state === 'connected' ? 'RECONNECT' : selectedGroup === 'openai' ? 'CONNECT CHATGPT' : 'CONNECT CLAUDE'}
              </button>
              {oauthStatus?.state === 'connecting' && (
                <button className="pill-btn" onClick={() => onCancelAuth(selectedGroup as 'anthropic' | 'openai')} style={{ fontSize: 9 }}>
                  CANCEL LOGIN
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 14 }}>
          <button className="pill-btn" onClick={onCancel} style={{ fontSize: 10 }}>
            CANCEL
          </button>
          <button
            className="pill-btn"
            onClick={() => onApply(selectedGroup, effectiveModel, authMethod, apiKey || undefined)}
            style={{ fontSize: 10, opacity: canApply ? 1 : 0.4 }}
            disabled={!canApply}
          >
            APPLY
          </button>
        </div>
      </div>
    </div>
  );
}
