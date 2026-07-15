import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, X, MessageSquarePlus, Square, Clipboard, Pencil, Trash2, Search, Menu, ArrowDown, Check, FolderPlus, Folder, ChevronRight, ChevronDown, Monitor, Plus, AudioLines, MessagesSquare, LayoutGrid, Bell } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark-reasonable.css';
import type { Message, Conversation, ChatFolderState, Notice } from '../types';
import { NoticeIcon, cleanNoticeTitle } from './NoticeIcon';
import { TOOL_NOTICE_MS, type ToolActivity } from './TerminalOverlay';
import type { VoiceApi } from '../hooks/useVoice';
import { toolPersona, personaLabel } from '../lib/personas';

interface ChatPageProps {
  messages: Message[];
  onSend: (text: string) => void;
  streamingId: string | null;
  pendingConfirm: {
    id: string; tool: string; input: Record<string, unknown>; description: string;
  } | null;
  onConfirm: (decision: 'approved' | 'denied') => void;
  onClose: () => void;
  onNewChat?: () => void;
  conversations?: Conversation[];
  currentConvId?: string;
  onSwitchChat?: (id: string) => void;
  onDeleteChat?: (id: string) => void;
  onRenameChat?: (id: string, title: string) => void;
  onStopStream?: () => void;
  toolActivities?: ToolActivity[];
  onEditMessage?: (messageId: string, newContent: string) => void;
  model?: string;
  voice?: VoiceApi;
  folderState?: ChatFolderState;
  onFolderStateChange?: (next: ChatFolderState) => void;
  onOpenModelConfig?: () => void;
  connected?: boolean;
  notices?: Notice[];
  onDismissNotice?: (id: string) => void;
}

const SUGGESTIONS = [
  '¿Cuáles son mis pendientes de hoy?',
  'Resúmeme mis notas recientes',
  'Ayúdame a planear mi semana',
  'Cuéntame algo interesante',
];

const FOLDERS_KEY = 'escarlata_chat_folders';
const RAIL_KEY = 'escarlata_chat_rail';

interface FolderDef { id: string; name: string; }
interface FolderState { folders: FolderDef[]; assign: Record<string, string>; }

function loadFolders(): FolderState {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p.folders) && p.assign) return p;
    }
  } catch { /* ignore */ }
  return { folders: [], assign: {} };
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// Saludo por hora del día (empty state móvil, estilo Claude iOS)
function greeting() {
  const h = new Date().getHours();
  return `${h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'}, Rubén`;
}

// Clean up raw/timestamp-y conversation titles into something friendly.
function prettyConvTitle(title: string): string {
  const t = (title || '').trim();
  if (!t) return 'Nueva conversación';
  const stripped = t.replace(/^\[[^\]]*\]\s*/, '').trim();
  if (stripped) return stripped;
  if (/^\[/.test(t)) return 'Nueva conversación';
  if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)/i.test(t)) {
    return 'Nueva conversación';
  }
  return t;
}

export function ChatPage({ messages, onSend, streamingId, pendingConfirm, onConfirm, onClose, onNewChat, conversations, currentConvId, onSwitchChat, onDeleteChat, onRenameChat, onStopStream, toolActivities, onEditMessage, model, voice, folderState: serverFolderState, onFolderStateChange, onOpenModelConfig, connected = true, notices, onDismissNotice }: ChatPageProps) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  // Móvil: rail siempre cerrado al abrir (drawer bajo demanda); desktop respeta localStorage
  const [railOpen, setRailOpen] = useState(() =>
    window.matchMedia('(max-width: 768px)').matches ? false : localStorage.getItem(RAIL_KEY) !== '0'
  );
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // --- Folders: sincronizadas vía servidor cuando hay props; localStorage como fallback ---
  const [localFolderState, setLocalFolderState] = useState<FolderState>(loadFolders);
  const synced = !!onFolderStateChange;
  const folderState = useMemo<FolderState>(
    () => (synced ? (serverFolderState ?? { folders: [], assign: {} }) : localFolderState),
    [synced, serverFolderState, localFolderState],
  );
  const setFolderState = (updater: FolderState | ((s: FolderState) => FolderState)) => {
    const next = typeof updater === 'function' ? updater(folderState) : updater;
    if (synced) onFolderStateChange!(next);
    else setLocalFolderState(next);
  };
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderRenameInput, setFolderRenameInput] = useState('');
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);

  // Migración única: carpetas locales previas suben al servidor si este aún no tiene ninguna
  const migratedRef = useRef(false);
  useEffect(() => {
    if (!synced || !serverFolderState || migratedRef.current) return;
    migratedRef.current = true;
    if (serverFolderState.folders.length === 0 && Object.keys(serverFolderState.assign).length === 0) {
      const local = loadFolders();
      if (local.folders.length > 0 || Object.keys(local.assign).length > 0) {
        onFolderStateChange!(local);
      }
    }
  }, [synced, serverFolderState, onFolderStateChange]);

  useEffect(() => {
    if (synced) return; // en modo servidor no se persiste localmente
    try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(localFolderState)); } catch { /* ignore */ }
  }, [localFolderState, synced]);
  useEffect(() => { localStorage.setItem(RAIL_KEY, railOpen ? '1' : '0'); }, [railOpen]);

  const createFolder = (name: string) => {
    const n = name.trim();
    if (!n) return;
    setFolderState(s => ({ ...s, folders: [...s.folders, { id: `f-${Date.now()}`, name: n }] }));
  };
  const renameFolder = (id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setFolderState(s => ({ ...s, folders: s.folders.map(f => f.id === id ? { ...f, name: n } : f) }));
  };
  const deleteFolder = (id: string) => {
    setFolderState(s => {
      const assign = { ...s.assign };
      for (const k of Object.keys(assign)) if (assign[k] === id) delete assign[k];
      return { folders: s.folders.filter(f => f.id !== id), assign };
    });
  };
  const moveConv = (convId: string, folderId: string | null) => {
    setFolderState(s => {
      const assign = { ...s.assign };
      if (folderId) assign[convId] = folderId; else delete assign[convId];
      return { ...s, assign };
    });
    setMoveMenuFor(null);
  };

  // Stick-to-bottom: solo autoscrollea si ya estabas cerca del fondo
  // (leer mensajes viejos durante el streaming no te arrastra abajo)
  const nearBottomRef = useRef(true);
  const scrollToBottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };
  useEffect(() => { if (nearBottomRef.current) scrollToBottom(); }, [messages]);

  // Móvil: con el teclado abierto iOS deja "panear" el visual viewport aunque el
  // documento tenga overflow:hidden. Tres defensas:
  // 1) --vvh: el layout se encoge exactamente al viewport visible (nada que panear)
  // 2) scrollTo(0,0) re-ancla el desplazamiento automático que hace iOS al enfocar
  // 3) touchmove bloqueado salvo dentro de contenedores con scroll real
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const mobile = window.matchMedia('(max-width: 768px)');
    let lastH = vv ? vv.height : 0;

    const update = () => {
      if (!vv) return;
      // pinch-zoom activo: no encoger el layout
      if (!mobile.matches || vv.scale > 1.01) {
        root.style.removeProperty('--vvh');
        return;
      }
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      window.scrollTo(0, 0);
      if (vv.height < lastH - 50) {
        // teclado recién abierto: mantener el hilo pegado a la caja de texto
        requestAnimationFrame(scrollToBottom);
      }
      lastH = vv.height;
    };

    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);

    const onTouchMove = (e: TouchEvent) => {
      let node = e.target instanceof Element ? e.target : null;
      while (node && node !== document.documentElement) {
        const st = getComputedStyle(node);
        if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 1) return;
        node = node.parentElement;
      }
      e.preventDefault();
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      document.removeEventListener('touchmove', onTouchMove);
      root.style.removeProperty('--vvh');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = fromBottom < 120;
    setShowScrollBtn(fromBottom >= 120);
  };

  // Filter conversations, split into folders vs recents (sorted by updatedAt desc).
  const { foldered, recents } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (conversations || [])
      .filter(c => prettyConvTitle(c.title).toLowerCase().includes(q))
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const validIds = new Set(folderState.folders.map(f => f.id));
    const byFolder: Record<string, Conversation[]> = {};
    const rec: Conversation[] = [];
    for (const c of list) {
      const fid = folderState.assign[c.id];
      if (fid && validIds.has(fid)) (byFolder[fid] ||= []).push(c);
      else rec.push(c);
    }
    return { foldered: byFolder, recents: rec };
  }, [conversations, search, folderState]);

  const handleSend = () => {
    if (!input.trim() || streamingId || !connected) return;
    onSend(input.trim());
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleEditStart = (msgId: string, content: string) => {
    setEditingId(msgId);
    setEditContent(content);
    setTimeout(() => { editRef.current?.focus(); editRef.current?.select(); }, 50);
  };
  const handleEditConfirm = () => {
    if (editingId && editContent.trim()) {
      onEditMessage?.(editingId, editContent.trim());
      setEditingId(null);
      setEditContent('');
    }
  };
  const handleEditKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditConfirm(); }
    if (e.key === 'Escape') { setEditingId(null); setEditContent(''); }
  };

  const handleRenameConfirm = () => {
    if (renamingId && renameInput.trim()) onRenameChat?.(renamingId, renameInput.trim());
    setRenamingId(null);
    setRenameInput('');
  };
  const handleRenameStart = (convId: string, currentTitle: string) => {
    if (renamingId && renamingId !== convId) handleRenameConfirm();
    setRenamingId(convId);
    setRenameInput(prettyConvTitle(currentTitle));
    setTimeout(() => { renameRef.current?.focus(); renameRef.current?.select(); }, 50);
  };
  const handleRenameKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleRenameConfirm(); }
    if (e.key === 'Escape') { setRenamingId(null); setRenameInput(''); }
  };

  // Borrado en dos toques: el primero arma (icono en rojo), el segundo confirma; se desarma solo
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDeleteClick = (convId: string) => {
    if (confirmDeleteId === convId) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmDeleteId(null);
      onDeleteChat?.(convId);
      return;
    }
    setConfirmDeleteId(convId);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
  };

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  const iconBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
    padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4, transition: 'color 0.2s',
  };

  // Show the "¿Qué hacemos hoy?" view until the user actually sends a message
  // (ignore any assistant greeting so it stays exclusive to the terminal view).
  const empty = !messages.some(m => m.role === 'user');
  const currentConversation = useMemo(
    () => conversations?.find(conversation => conversation.id === currentConvId),
    [conversations, currentConvId],
  );
  const threadTitle = prettyConvTitle(currentConversation?.title || 'Nueva conversación');

  // Sheet de notificaciones (móvil)
  const [noticesOpen, setNoticesOpen] = useState(false);
  const activeNotices = (notices || []).filter(n => !n.dismissed);

  // --- Conversation row (shared by folders + recents) ---
  const convRow = (conv: Conversation) => (
    <div
      key={conv.id}
      className={`chat-conv-item${conv.id === currentConvId ? ' active' : ''}`}
      onClick={() => {
        if (renamingId === conv.id) return;
        onSwitchChat?.(conv.id);
        if (window.matchMedia('(max-width: 768px)').matches) setRailOpen(false);
      }}
    >
      {renamingId === conv.id ? (
        <input
          ref={renameRef}
          value={renameInput}
          onChange={e => setRenameInput(e.target.value)}
          onKeyDown={handleRenameKey}
          onBlur={handleRenameConfirm}
          onClick={e => e.stopPropagation()}
          className="chat-rename-input"
        />
      ) : (
        <div className="chat-conv-title">{prettyConvTitle(conv.title)}</div>
      )}
      <div className="chat-conv-meta">
        {conv.messageCount} msgs · {new Date(conv.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
      </div>
      <div className="chat-conv-acts">
        <button onClick={e => { e.stopPropagation(); setMoveMenuFor(moveMenuFor === conv.id ? null : conv.id); }} title="Mover a carpeta">
          <FolderPlus size={13} />
        </button>
        {onRenameChat && (
          <button onClick={e => { e.stopPropagation(); handleRenameStart(conv.id, conv.title); }} title="Renombrar">
            <Pencil size={13} />
          </button>
        )}
        {onDeleteChat && (
          <button
            onClick={e => { e.stopPropagation(); handleDeleteClick(conv.id); }}
            title={confirmDeleteId === conv.id ? 'Toca otra vez para eliminar' : 'Eliminar'}
            style={confirmDeleteId === conv.id ? { color: '#ff6b6b' } : undefined}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {moveMenuFor === conv.id && (
        <div className="chat-move-menu" onClick={e => e.stopPropagation()}>
          {folderState.folders.length === 0 && <div className="chat-move-empty">Sin carpetas</div>}
          {folderState.folders.map(f => (
            <button key={f.id} onClick={() => moveConv(conv.id, f.id)}>
              <Folder size={12} /> {f.name}
            </button>
          ))}
          {folderState.assign[conv.id] && (
            <button className="danger" onClick={() => moveConv(conv.id, null)}>Quitar de carpeta</button>
          )}
        </div>
      )}
    </div>
  );

  // --- Input block: pill de dos filas (textarea arriba, acciones abajo) ---
  const inputBlock = (
    <div className={`chat-input-bar${empty ? ' centered' : ''}`}>
      <div className="chat-input-card">
        <div className="chat-context-chips chat-d-only">
          <span className="chat-chip"><Monitor size={11} /> Este equipo</span>
          <span className="chat-chip"><Folder size={11} /> {threadTitle}</span>
          {streamingId && <span className="chat-chip accent">Transmitiendo</span>}
        </div>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); autoResize(e.target); }}
          onKeyDown={handleKey}
          placeholder={!connected ? 'Reconectando…' : streamingId ? 'Esperando respuesta…' : 'Chat con Escarlata'}
          rows={1}
          className="chat-input-textarea"
        />
        <div className="chat-pill-row">
          {onNewChat && (
            <button className="chat-pill-btn" onClick={() => onNewChat()} title="Nuevo chat">
              <Plus size={18} />
            </button>
          )}
          {model && (
            <button className="chat-model-chip" onClick={onOpenModelConfig} title="Cambiar modelo">
              {model}
            </button>
          )}
          <div className="chat-pill-spacer" />
          {voice && (
            <button
              onMouseDown={() => voice.status === 'standby' && voice.startRecording()}
              onMouseUp={() => voice.status === 'recording' && voice.stopRecording()}
              onMouseLeave={() => voice.status === 'recording' && voice.stopRecording()}
              onTouchStart={e => { e.preventDefault(); if (voice.status === 'standby') voice.startRecording(); }}
              onTouchEnd={e => { e.preventDefault(); if (voice.status === 'recording') voice.stopRecording(); }}
              disabled={voice.status === 'transcribing'}
              className={`chat-voice-btn${voice.ttsEnabled ? ' on' : ''}${voice.status === 'recording' ? ' recording' : ''}`}
              title="Mantén presionado para hablar"
            >
              <AudioLines size={16} />
            </button>
          )}
          {streamingId ? (
            <button onClick={onStopStream} className="chat-stop-btn" title="Detener">
              <Square size={16} />
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim() || !connected} className={`chat-send-btn${input.trim() && connected ? ' active' : ''}`} title="Enviar">
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
      {!empty && <div className="chat-input-hint">Enter para enviar · Shift+Enter para salto de línea</div>}
    </div>
  );

  return (
    <div className="chat-page">
      {/* Backdrop del drawer (solo móvil) */}
      {railOpen && <div className="chat-rail-backdrop chat-m-only" onClick={() => setRailOpen(false)} />}

      {/* Left conversation rail */}
      <div className={`chat-rail${railOpen ? '' : ' collapsed'}`}>
        <div className="chat-rail-head">
          <button onClick={() => setRailOpen(false)} style={iconBtnStyle} title="Colapsar">
            <Menu size={16} />
          </button>
          <span className="chat-rail-title">Chats</span>
          <button onClick={onClose} style={{ ...iconBtnStyle, marginLeft: 'auto' }} title="Cerrar">
            <X size={16} />
          </button>
        </div>

        {/* Nav móvil (estilo Claude iOS) */}
        <div className="chat-rail-nav chat-m-only">
          <button className="active" onClick={() => setRailOpen(false)}>
            <MessagesSquare size={16} /> Chats
          </button>
          <button onClick={onClose}>
            <LayoutGrid size={16} /> Dashboard
          </button>
        </div>

        {onNewChat && (
          <button className="chat-new-btn chat-d-only" onClick={() => onNewChat()}>
            <MessageSquarePlus size={15} />
            <span>Nuevo chat</span>
          </button>
        )}

        <div className="chat-search">
          <Search size={13} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…" spellCheck={false} />
        </div>

        <div className="chat-conv-list">
          {/* Folders */}
          <div className="chat-section-head">
            <span>Destacados</span>
            <button onClick={() => { setCreatingFolder(true); setNewFolderName(''); }} title="Nueva carpeta">
              <FolderPlus size={13} />
            </button>
          </div>
          {creatingFolder && (
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { createFolder(newFolderName); setCreatingFolder(false); }
                if (e.key === 'Escape') setCreatingFolder(false);
              }}
              onBlur={() => { createFolder(newFolderName); setCreatingFolder(false); }}
              placeholder="Nombre de carpeta"
              className="chat-rename-input"
              style={{ margin: '2px 4px 6px' }}
            />
          )}
          {folderState.folders.map(f => {
            const list = foldered[f.id] || [];
            const isCol = collapsed[f.id];
            return (
              <div key={f.id} className="chat-folder">
                <div className="chat-folder-head" onClick={() => setCollapsed(c => ({ ...c, [f.id]: !c[f.id] }))}>
                  {isCol ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <Folder size={13} />
                  {renamingFolder === f.id ? (
                    <input
                      autoFocus
                      value={folderRenameInput}
                      onChange={e => setFolderRenameInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { renameFolder(f.id, folderRenameInput); setRenamingFolder(null); }
                        if (e.key === 'Escape') setRenamingFolder(null);
                      }}
                      onBlur={() => { renameFolder(f.id, folderRenameInput); setRenamingFolder(null); }}
                      onClick={e => e.stopPropagation()}
                      className="chat-rename-input"
                    />
                  ) : (
                    <span className="chat-folder-name">{f.name}</span>
                  )}
                  <span className="chat-folder-count">{list.length}</span>
                  <div className="chat-folder-acts">
                    <button onClick={e => { e.stopPropagation(); setRenamingFolder(f.id); setFolderRenameInput(f.name); }} title="Renombrar carpeta">
                      <Pencil size={12} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteFolder(f.id); }} title="Eliminar carpeta">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {!isCol && (
                  <div className="chat-folder-body">
                    {list.length === 0 ? <div className="chat-move-empty">Vacía</div> : list.map(convRow)}
                  </div>
                )}
              </div>
            );
          })}
          {folderState.folders.length === 0 && !creatingFolder && (
            <div className="chat-rail-empty">Sin carpetas</div>
          )}

          {/* Recents */}
          <div className="chat-section-head" style={{ marginTop: 8 }}><span>Recientes</span></div>
          {recents.length === 0 ? (
            <div className="chat-rail-empty">{search ? 'Sin resultados' : 'No conversations'}</div>
          ) : recents.map(convRow)}
        </div>

        {/* Footer profile */}
        <div className="chat-rail-footer">
          <div className="chat-avatar">E</div>
          <div className="chat-profile">
            <div className="chat-profile-name">Escarlata</div>
            <div className="chat-profile-sub">{model || 'asistente'}</div>
          </div>
          {onNewChat && (
            <button className="chat-newchat-pill chat-m-only" onClick={() => { onNewChat(); setRailOpen(false); }}>
              <Plus size={15} /> Nuevo chat
            </button>
          )}
        </div>
      </div>

      {/* Main column */}
      <div className="chat-main">
        <header className="chat-command-head chat-d-only">
          <div className="chat-command-title">
            <span className="chat-command-kicker">HILO DE CONVERSACIÓN</span>
            <h1 title={threadTitle}>{threadTitle}</h1>
          </div>
          <div className="chat-command-status" aria-label={connected ? 'Escarlata conectada' : 'Escarlata desconectada'}>
            <span className={`chat-status-light${connected ? '' : ' offline'}`} />
            <span>{streamingId ? 'EN RESPUESTA' : connected ? 'LISTA' : 'SIN CONEXIÓN'}</span>
            {model && <button onClick={onOpenModelConfig} className="chat-head-model" title="Cambiar modelo">{model}</button>}
          </div>
        </header>
        {!connected && (
          <div className="chat-conn-banner">
            <span className="chat-conn-dot" /> SIN CONEXIÓN · RECONECTANDO…
          </div>
        )}
        {/* Top bar móvil: hamburguesa + campana + cerrar */}
        <div className="chat-mobile-top chat-m-only">
          <button className="chat-round-btn" onClick={() => setRailOpen(true)} aria-label="Abrir chats">
            <Menu size={18} />
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="chat-round-btn" onClick={() => setNoticesOpen(true)} aria-label="Notificaciones">
              <Bell size={17} />
              {activeNotices.length > 0 && <span className="chat-bell-badge">{activeNotices.length > 9 ? '9+' : activeNotices.length}</span>}
            </button>
            <button className="chat-round-btn" onClick={onClose} aria-label="Volver al dashboard">
              <X size={18} />
            </button>
          </div>
        </div>

        {!railOpen && (
          <button className="chat-rail-toggle chat-d-only" onClick={() => setRailOpen(true)} title="Mostrar chats">
            <Menu size={16} />
          </button>
        )}

        {empty ? (
          <div className="chat-empty-centered">
            <div className="chat-empty-logo chat-m-only" aria-hidden="true">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round">
                <line x1="16.5" y1="12" x2="22.5" y2="12" />
                <line x1="15.18" y1="15.18" x2="19.42" y2="19.42" />
                <line x1="12" y1="16.5" x2="12" y2="22.5" />
                <line x1="8.82" y1="15.18" x2="4.58" y2="19.42" />
                <line x1="7.5" y1="12" x2="1.5" y2="12" />
                <line x1="8.82" y1="8.82" x2="4.58" y2="4.58" />
                <line x1="12" y1="7.5" x2="12" y2="1.5" />
                <line x1="15.18" y1="8.82" x2="19.42" y2="4.58" />
              </svg>
            </div>
            <div className="chat-greeting chat-m-only">{greeting()}</div>
            <div className="chat-empty-title chat-d-only">Abre un hilo. Da una orden.</div>
            <p className="chat-empty-copy chat-d-only">Escarlata conserva el contexto de esta conversación mientras trabajamos.</p>
            {inputBlock}
            <div className="chat-suggestions chat-d-only">
              {SUGGESTIONS.map(s => (
                <button key={s} className="chat-suggestion" onClick={() => onSend(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="chat-messages" onScroll={onScroll}>
              <div className="chat-thread" aria-live="polite" aria-label="Mensajes de la conversación">
                {messages.map((msg, i) => {
                  const prev = messages[i - 1];
                  const showSender = !prev || prev.role !== msg.role;
                  return (
                    <div key={msg.id} className={`chat-msg-row ${msg.role}${msg.isStreaming ? ' streaming' : ''} animate-fade-in`} style={{ marginTop: showSender ? 22 : 6 }}>
                      {msg.role === 'assistant' && showSender && (
                        <div className="chat-msg-head">
                          <div className="chat-avatar">E</div>
                          <span className="chat-msg-name">Escarlata</span>
                          <span className="chat-msg-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      )}
                      <div className={`chat-bubble ${msg.role}`}
                        onMouseEnter={e => { const b = e.currentTarget.querySelector('.msg-actions'); if (b) (b as HTMLElement).style.opacity = '1'; }}
                        onMouseLeave={e => { const b = e.currentTarget.querySelector('.msg-actions'); if (b) (b as HTMLElement).style.opacity = '0'; }}
                      >
                        {msg.isStreaming && !msg.content ? (
                          <div style={{ display: 'flex', gap: 3, padding: '4px 0' }}>
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                          </div>
                        ) : editingId === msg.id ? (
                          <div>
                            <textarea
                              ref={editRef}
                              value={editContent}
                              onChange={e => { setEditContent(e.target.value); autoResize(e.target); }}
                              onKeyDown={handleEditKey}
                              rows={3}
                              className="chat-edit-input"
                            />
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              <button className="chat-mini-btn primary" onClick={handleEditConfirm}>Guardar</button>
                              <button className="chat-mini-btn" onClick={() => setEditingId(null)}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <div className="markdown-content chat-md">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                        {!msg.isStreaming && !(editingId === msg.id) && (
                          <div className="msg-actions" style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.2s' }}>
                            <button onClick={() => navigator.clipboard.writeText(msg.content)} style={iconBtnStyle} title="Copiar">
                              <Clipboard size={13} />
                            </button>
                            {msg.role === 'user' && onEditMessage && (
                              <button onClick={() => handleEditStart(msg.id, msg.content)} style={iconBtnStyle} title="Editar">
                                <Pencil size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {showScrollBtn && (
              <button className="chat-scroll-btn" onClick={scrollToBottom} title="Ir al final">
                <ArrowDown size={16} />
              </button>
            )}

            {pendingConfirm && (
              <div className="chat-confirm-card">
                <div className="chat-confirm-body">
                  <span className="chat-confirm-dot">◆</span>
                  <div>
                    <div className="chat-confirm-tool">{toolPersona(pendingConfirm.tool).gem} quiere seguir {toolPersona(pendingConfirm.tool).action}</div>
                    <div className="chat-confirm-desc">{pendingConfirm.description}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="chat-mini-btn" onClick={() => onConfirm('denied')}>Denegar</button>
                  <button className="chat-mini-btn primary" onClick={() => onConfirm('approved')}>Permitir</button>
                </div>
              </div>
            )}

            {toolActivities && toolActivities.length > 0 && (
              <div className="chat-tools">
                {toolActivities.map(a => (
                  <div key={a.id} className="chat-tool-card">
                    {a.status === 'running' ? <span className="chat-tool-spin" /> : <Check size={12} color="var(--accent-bright)" />}
                    <span className="chat-tool-name">{personaLabel(a.name)}</span>
                    {a.status === 'done' && a.result && <span className="chat-tool-result">{a.result}</span>}
                    {a.status === 'done' && <span className="chat-tool-countdown" style={{ ['--tool-notice-ms' as string]: `${TOOL_NOTICE_MS}ms` }} />}
                  </div>
                ))}
              </div>
            )}

            {inputBlock}
          </>
        )}
      </div>

      {/* Sheet de notificaciones (móvil) */}
      {noticesOpen && (
        <>
          <div className="chat-rail-backdrop" style={{ zIndex: 30 }} onClick={() => setNoticesOpen(false)} />
          <div className="chat-notice-sheet">
            <div className="chat-notice-sheet-head">
              <span className="chat-notice-sheet-title">NOTIFICACIONES · {activeNotices.length}</span>
              {activeNotices.length > 0 && onDismissNotice && (
                <button className="chat-mini-btn" onClick={() => activeNotices.forEach(n => onDismissNotice(n.id))}>
                  Limpiar
                </button>
              )}
              <button onClick={() => setNoticesOpen(false)} style={iconBtnStyle} aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>
            <div className="chat-notice-sheet-list">
              {activeNotices.length === 0 ? (
                <div className="chat-rail-empty" style={{ padding: '24px 0' }}>Sin notificaciones</div>
              ) : (
                activeNotices.map(n => (
                  <div key={n.id} className={`chat-notice-item${n.severity === 'important' ? ' important' : ''}`}>
                    <NoticeIcon source={n.source} createdAt={n.createdAt} size={14} />
                    <div className="chat-notice-item-body">
                      <div className="chat-notice-item-title">
                        {cleanNoticeTitle(n.title)}
                        <span className="chat-notice-item-time">{timeAgo(n.createdAt)}</span>
                      </div>
                      {n.body && <div className="chat-notice-item-text">{n.body}</div>}
                      {n.actions && n.actions.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          {n.actions.map(a => (
                            <button
                              key={a.label}
                              className="chat-mini-btn"
                              onClick={() => { setNoticesOpen(false); onSend(a.command); }}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {onDismissNotice && (
                      <button className="chat-notice-item-dismiss" onClick={() => onDismissNotice(n.id)} aria-label="Descartar">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
