import { useState, useRef, useEffect } from 'react';
import { Send, Terminal, X, MessageSquarePlus, List, Square, Clipboard, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark-reasonable.css';
import type { Message, Conversation } from '../types';
import { toolPersona, personaLabel } from '../lib/personas';

interface TerminalOverlayProps {
  messages: Message[];
  onSend: (text: string) => void;
  streamingId: string | null;
  pendingConfirm: {
    id: string; tool: string; input: Record<string, unknown>; description: string;
  } | null;
  onConfirm: (decision: 'approved' | 'denied') => void;
  isOpen: boolean;
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
}

/** How long a finished tool/subagent card stays visible before auto-dismissing */
export const TOOL_NOTICE_MS = 10000;

export interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'done';
  input?: Record<string, unknown>;
  result?: string;
}

export function TerminalOverlay({ messages, onSend, streamingId, pendingConfirm, onConfirm, isOpen, onClose, onNewChat, conversations, currentConvId, onSwitchChat, onDeleteChat, onRenameChat, onStopStream, toolActivities, onEditMessage }: TerminalOverlayProps) {
  const [input, setInput] = useState('');
  const [closing, setClosing] = useState(false);
  const [showConvList, setShowConvList] = useState(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedInput, setSavedInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  // Borrado en dos clics (se desarma solo a los 3s)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      setShowConvList(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = () => {
    if (!input.trim() || streamingId) return;
    onSend(input.trim());
    setInputHistory(prev => [...prev, input.trim()]);
    setHistoryIdx(-1);
    setSavedInput('');
    setInput('');
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === 'ArrowUp' && inputHistory.length > 0) {
      e.preventDefault();
      if (historyIdx === -1) {
        setSavedInput(input);
        setHistoryIdx(inputHistory.length - 1);
        setInput(inputHistory[inputHistory.length - 1]);
      } else if (historyIdx > 0) {
        setHistoryIdx(historyIdx - 1);
        setInput(inputHistory[historyIdx - 1]);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx >= 0 && historyIdx < inputHistory.length - 1) {
        setHistoryIdx(historyIdx + 1);
        setInput(inputHistory[historyIdx + 1]);
      } else if (historyIdx === inputHistory.length - 1) {
        setHistoryIdx(-1);
        setInput(savedInput);
      }
      return;
    }
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditConfirm();
    }
    if (e.key === 'Escape') {
      setEditingId(null);
      setEditContent('');
    }
  };

  const handleRenameConfirm = () => {
    if (renamingId && renameInput.trim()) {
      onRenameChat?.(renamingId, renameInput.trim());
    }
    setRenamingId(null);
    setRenameInput('');
  };

  const handleRenameStart = (convId: string, currentTitle: string) => {
    // Save any in-progress rename first
    if (renamingId && renamingId !== convId) {
      handleRenameConfirm();
    }
    setRenamingId(convId);
    setRenameInput(currentTitle);
    setTimeout(() => { renameRef.current?.focus(); renameRef.current?.select(); }, 50);
  };

  const handleRenameKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameConfirm();
    }
    if (e.key === 'Escape') {
      setRenamingId(null);
      setRenameInput('');
    }
  };

  const close = () => {
    setClosing(true);
    setTimeout(() => { onClose(); setClosing(false); }, 300);
  };

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  const iconBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
    padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4, transition: 'color 0.2s',
  };

  if (!isOpen && !closing) return null;

  return (
    <div
      className={`terminal-overlay ${closing ? 'closed' : 'open'}`}
      onClick={e => e.stopPropagation()}
    >
      {/* Header bar */}
      <div style={{
        height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={14} color="var(--accent-dim)" />
          <span className="label" style={{ color: 'var(--accent-text)' }}>AGENT TERMINAL</span>
          <span className="label-sm">LIVE</span>
          <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} className="animate-pulse-opacity" />
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {onNewChat && (
            <button onClick={() => { onNewChat(); setShowConvList(false); }} style={iconBtnStyle} title="New Chat">
              <MessageSquarePlus size={14} />
            </button>
          )}
          <button onClick={() => setShowConvList(v => !v)} style={{ ...iconBtnStyle, color: showConvList ? 'var(--accent-bright)' : 'var(--text-muted)' }} title="Conversations">
            <List size={14} />
          </button>
          {pendingConfirm && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginRight: 4 }}>
              <span className="label-sm">{toolPersona(pendingConfirm.tool).gem}: ¿{toolPersona(pendingConfirm.tool).action}?</span>
              <button className="hud-btn" style={{ fontSize: 8, padding: '2px 8px' }} onClick={() => onConfirm('denied')}>DENY</button>
              <button className="hud-btn" style={{ fontSize: 8, padding: '2px 8px' }} onClick={() => onConfirm('approved')}>APPR</button>
            </div>
          )}
          <button onClick={close} style={iconBtnStyle}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body: conversation list + chat split */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Conversation list panel */}
        {showConvList && conversations && (
          <div className="conv-list-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="label">CONVERSATIONS</span>
              <span className="label-sm">{conversations.length}</span>
            </div>
            <div className="separator" />
            <div style={{ flex: 1, overflow: 'auto', marginTop: 4 }}>
              {conversations.length === 0 ? (
                <div className="label-sm" style={{ padding: 16, textAlign: 'center' }}>No conversations</div>
              ) : (
                  conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => { if (renamingId !== conv.id) onSwitchChat?.(conv.id); }}
                    style={{
                      padding: '6px 10px', cursor: 'pointer', borderRadius: 4,
                      background: conv.id === currentConvId ? 'var(--accent-glow)' : 'transparent',
                      borderLeft: conv.id === currentConvId ? '2px solid var(--accent)' : '2px solid transparent',
                      marginBottom: 2, transition: 'all 0.2s', position: 'relative',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = conv.id === currentConvId ? 'var(--accent-glow)' : 'rgba(255,255,255,0.03)'; const btns = e.currentTarget.querySelectorAll('.conv-act-btn'); btns.forEach(b => (b as HTMLElement).style.opacity = '1'); }}
                    onMouseLeave={e => { e.currentTarget.style.background = conv.id === currentConvId ? 'var(--accent-glow)' : 'transparent'; const btns = e.currentTarget.querySelectorAll('.conv-act-btn'); btns.forEach(b => (b as HTMLElement).style.opacity = '0'); }}
                  >
                    {renamingId === conv.id ? (
                      <input
                        ref={renameRef}
                        value={renameInput}
                        onChange={e => setRenameInput(e.target.value)}
                        onKeyDown={handleRenameKey}
                        onBlur={handleRenameConfirm}
                        onClick={e => e.stopPropagation()}
                        style={{
                          width: '100%', padding: '2px 4px', marginBottom: 2,
                          background: 'rgba(0,0,0,0.4)', border: '1px solid var(--accent-dim)',
                          color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 11,
                          outline: 'none', borderRadius: 2,
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 40 }}>
                        {conv.title}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-muted)' }}>
                      <span>{conv.messageCount} msgs</span>
                      <span>{new Date(conv.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 2 }}>
                      {onRenameChat && (
                        <button
                          className="conv-act-btn"
                          onClick={e => { e.stopPropagation(); handleRenameStart(conv.id, conv.title); }}
                          style={{
                            opacity: 0, transition: 'opacity 0.2s',
                            background: 'none', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', padding: '2px 4px', borderRadius: 3, fontSize: 10, lineHeight: 1,
                          }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent-bright)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
                          title="Rename conversation"
                        >
                          ✎
                        </button>
                      )}
                      {onDeleteChat && (
                        <button
                          className="conv-act-btn"
                          onClick={e => {
                            e.stopPropagation();
                            if (confirmDeleteId === conv.id) {
                              if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                              setConfirmDeleteId(null);
                              onDeleteChat(conv.id);
                            } else {
                              setConfirmDeleteId(conv.id);
                              if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                              confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
                            }
                          }}
                          style={{
                            opacity: confirmDeleteId === conv.id ? 1 : 0, transition: 'opacity 0.2s',
                            background: 'none', border: 'none',
                            color: confirmDeleteId === conv.id ? '#ff6b6b' : 'var(--accent-dim)',
                            cursor: 'pointer', padding: '2px 4px', borderRadius: 3, fontSize: 10, lineHeight: 1,
                          }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent-bright)'}
                          onMouseLeave={e => { if (confirmDeleteId !== conv.id) (e.currentTarget as HTMLElement).style.color = 'var(--accent-dim)'; }}
                          title={confirmDeleteId === conv.id ? 'Click again to delete' : 'Delete conversation'}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Messages area */}
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {messages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.1em' }}>
              AWAITING INPUT...
            </div>
          )}
          {messages.map((msg, i) => {
            const prev = messages[i - 1];
            const showSender = !prev || prev.role !== msg.role;
            return (
              <div key={msg.id} className="animate-fade-in" style={{
                display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                marginTop: showSender ? 8 : 1, position: 'relative',
              }}>
                {showSender && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{
                      fontSize: 9, letterSpacing: '0.15em', fontWeight: 600,
                      color: msg.role === 'assistant' ? 'var(--accent-text)' : 'var(--text-secondary)',
                    }}>
                      {msg.role === 'assistant' ? '· ESCARLATA' : '· YOU'}
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
                <div style={{
                  padding: '8px 12px', maxWidth: '80%',
                  borderRadius: msg.role === 'assistant' ? '0 8px 8px 8px' : '8px 0 8px 8px',
                  background: msg.role === 'assistant' ? 'rgba(255,255,255,0.04)' : 'rgba(124,108,240,0.08)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12.5, lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  position: 'relative',
                }}
                  onMouseEnter={e => { const btn = e.currentTarget.querySelector('.msg-actions'); if (btn) (btn as HTMLElement).style.opacity = '1'; }}
                  onMouseLeave={e => { const btn = e.currentTarget.querySelector('.msg-actions'); if (btn) (btn as HTMLElement).style.opacity = '0'; }}
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
                        style={{
                          width: '100%', border: '1px solid var(--accent-dim)', background: 'rgba(0,0,0,0.4)',
                          color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 12,
                          outline: 'none', padding: 6, borderRadius: 4, resize: 'none',
                          lineHeight: 1.5,
                        }}
                      />
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <button className="hud-btn" style={{ fontSize: 8, padding: '2px 8px' }} onClick={handleEditConfirm}>SAVE</button>
                        <button className="hud-btn" style={{ fontSize: 8, padding: '2px 8px' }} onClick={() => setEditingId(null)}>CANCEL</button>
                      </div>
                    </div>
                  ) : (
                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                  {/* Message actions: copy + edit */}
                  {!msg.isStreaming && (
                    <div className="msg-actions" style={{
                      position: 'absolute', top: 4, right: 4, display: 'flex', gap: 2, opacity: 0,
                      transition: 'opacity 0.2s',
                    }}>
                      <button
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                        style={iconBtnStyle} title="Copy"
                      >
                        <Clipboard size={12} />
                      </button>
                      {msg.role === 'user' && onEditMessage && !editingId && (
                        <button
                          onClick={() => handleEditStart(msg.id, msg.content)}
                          style={iconBtnStyle} title="Edit"
                        >
                          <Pencil size={12} />
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

      {/* Confirmation bar inline */}
      {pendingConfirm && (
        <div style={{
          margin: '0 16px 8px', padding: '8px 12px',
          border: '1px solid rgba(255,217,61,0.2)', background: 'rgba(255,217,61,0.05)',
          borderRadius: 8, fontSize: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span><span style={{ color: '#ffd93d' }}>◆</span> {toolPersona(pendingConfirm.tool).gem} — {toolPersona(pendingConfirm.tool).action}: {pendingConfirm.description}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="hud-btn" style={{ fontSize: 8, padding: '2px 8px' }} onClick={() => onConfirm('denied')}>DENY</button>
            <button className="hud-btn" style={{ fontSize: 8, padding: '2px 8px' }} onClick={() => onConfirm('approved')}>ALLOW</button>
          </div>
        </div>
      )}

      {/* Tool activities */}
      {toolActivities && toolActivities.length > 0 && (
        <div style={{ padding: '4px 16px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          {toolActivities.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-secondary)', padding: '2px 0' }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: a.status === 'running' ? 'var(--accent-bright)' : 'var(--accent-dim)',
                animation: a.status === 'running' ? 'pulse-opacity 1s infinite' : 'none',
              }} />
              <span>{personaLabel(a.name)}</span>
              {a.status === 'done' && a.result && (
                <span className="label-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{a.result}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="terminal-input-bar" style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: 'rgba(0,0,0,0.3)', borderRadius: 8, border: '1px solid var(--border-subtle)', padding: '4px 4px 4px 12px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, paddingBottom: 6 }}>&gt;</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey}
            placeholder={streamingId ? 'WAITING FOR RESPONSE...' : 'TYPE MESSAGE OR COMMAND...'}
            rows={1}
            style={{
              flex: 1, border: 'none', background: 'transparent',
              color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 12,
              outline: 'none', padding: '6px 0', resize: 'none',
              maxHeight: 160, lineHeight: 1.5,
            }}
          />
          {streamingId ? (
            <button
              onClick={onStopStream}
              style={{
                background: 'rgba(255,80,80,0.15)', border: '1px solid rgba(255,80,80,0.3)',
                color: '#ff6b6b', cursor: 'pointer',
                padding: '6px 8px', borderRadius: 6, display: 'flex', alignItems: 'center',
                transition: 'all 0.2s', marginBottom: 2,
              }}
              title="Stop generation"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              style={{
                background: input.trim() ? 'var(--accent-dim)' : 'transparent',
                border: 'none', color: input.trim() ? 'var(--accent-text)' : 'var(--text-muted)',
                cursor: input.trim() ? 'pointer' : 'default',
                padding: '6px 8px', borderRadius: 6, display: 'flex', alignItems: 'center',
                transition: 'all 0.2s', marginBottom: 2,
              }}
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
