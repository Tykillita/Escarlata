import { useState, useEffect } from 'react';
import type { ToolDef, UsageStatsDay, Notice } from '../types';
import type { VoiceApi } from '../hooks/useVoice';
import type { ToolActivity } from './TerminalOverlay';
import { UsageHeatmap } from './UsageHeatmap';
import { QUICK_ACTIONS } from '../lib/personas';
import { NoticeIcon, cleanNoticeTitle } from './NoticeIcon';

// El wire es texto plano estilo HUD: pictogramas fuera, iconos SVG dentro
function stripEmojis(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Corner() {
  return (<>
    <div className="hud-corner tl" />
    <div className="hud-corner tr" />
    <div className="hud-corner bl" />
    <div className="hud-corner br" />
  </>);
}

function EqualizerBar({ active, delay }: { active: boolean; delay: number }) {
  return (
    <div style={{
      width: 4, borderRadius: 2,
      background: active ? 'var(--accent-dim)' : 'var(--border-subtle)',
      animation: active ? `equalizer 0.6s ease-in-out ${delay}s infinite` : 'none',
      alignSelf: 'center',
    }} />
  );
}

export function SidebarRight({ usageStats, voice, onOpenChat, onOpenTerminal, onOpenModelConfig, notices, onCommand, activities }: { tools?: ToolDef[]; usageStats: UsageStatsDay[]; voice: VoiceApi; onOpenChat: () => void; onOpenTerminal?: () => void; onOpenModelConfig?: () => void; notices?: Notice[]; onCommand: (text: string) => void; activities: ToolActivity[] }) {
  const running = activities.filter(a => a.status === 'running').length;
  const now = useNow();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  const dockIcons = [
    <svg key="grid" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/>
    </svg>,
    <svg key="dots" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2"/>
      <circle cx="12" cy="6" r="2"/>
      <circle cx="18" cy="6" r="2"/>
      <circle cx="6" cy="12" r="2"/>
      <circle cx="12" cy="12" r="2"/>
      <circle cx="18" cy="12" r="2"/>
      <circle cx="6" cy="18" r="2"/>
      <circle cx="12" cy="18" r="2"/>
      <circle cx="18" cy="18" r="2"/>
    </svg>,
    <svg key="chevrons" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
      <polyline points="5 18 11 12 5 6"/>
    </svg>,
  ];

  return (
    <div className="sidebar-right">
      {/* Top row: dock + clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 48, marginLeft: 16 }}>
        <div style={{ display: 'inline-flex', gap: 8, padding: '8px', borderRadius: 4, border: '1px solid var(--accent-line)' }}>
          {dockIcons.map((icon, i) => {
            const actions = [
              { title: 'Configurar modelo', fn: onOpenModelConfig },
              { title: 'Abrir terminal', fn: onOpenTerminal },
              { title: 'Abrir chat', fn: onOpenChat },
            ];
            const a = actions[i];
            return (
              <button key={i} type="button" className="hud-btn" title={a?.title} style={{ width: 38, height: 38, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3 }} onClick={() => a?.fn?.()}>
                {icon}
              </button>
            );
          })}
        </div>
        <div className="clock-block" style={{ textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, justifyContent: 'flex-end' }}>
          <span style={{ fontFamily: 'var(--font-clock)', fontSize: 'clamp(30px,3.4vw,44px)', fontWeight: 300, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em', color: 'var(--text-primary)', lineHeight: 1 }}>{hh}:{mm}</span>
          <span style={{ fontFamily: 'var(--font-clock)', fontSize: 'clamp(13px,1.3vw,18px)', fontWeight: 400, fontVariantNumeric: 'tabular-nums', color: 'var(--accent-bright)' }}>{ss}</span>
        </div>
        <div className="label-sm" style={{ letterSpacing: '0.18em', marginTop: 3, textAlign: 'right' }}>
          {days[now.getDay()]}<span style={{ color: 'var(--text-muted)' }}> · </span>{months[now.getMonth()]}<span style={{ color: 'var(--text-muted)' }}> · </span>{String(now.getDate()).padStart(2, '0')}
        </div>
        </div>
      </div>
      <div className="separator" style={{ margin: '8px 0' }} />

      {/* COMMAND DECK */}
      <div className="hud-panel" style={{ padding: 12 }}>
        <Corner />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="label">COMMAND DECK</span>
          <span className="label-sm" style={{ color: running > 0 ? 'var(--accent-bright)' : undefined }}>
            {running > 0 ? `RUNNING · ${running} ACTIVE` : 'IDLE'}
          </span>
        </div>
        <div className="separator" />
        <div className="command-deck-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {QUICK_ACTIONS.map((qa, i) => (
            <button
              key={qa.label}
              className="hud-btn"
              title={qa.phrase}
              onClick={() => onCommand(qa.phrase)}
              style={{ textAlign: 'left', padding: '4px 8px', fontSize: 9, border: 'none', borderBottom: i < QUICK_ACTIONS.length - 2 ? '1px solid var(--border-subtle)' : 'none', cursor: 'pointer' }}
            >
              · {qa.label}
            </button>
          ))}
        </div>
        <div className="label-sm" style={{ marginTop: 8, textAlign: 'center' }}>
          TOCA UNA ORDEN — ESCARLATA SE ENCARGA
        </div>
      </div>

      {/* AUDIO I/O */}
      <div className="hud-panel" style={{ padding: 12 }}>
        <Corner />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="label">AUDIO I/O</span>
          <span className="label-sm">
            {voice.status === 'speaking' ? 'TTS.ACTIVE' : voice.ttsEnabled ? 'TTS.STANDBY' : 'TTS.OFF'}
          </span>
          <button
            onClick={voice.toggleTts}
            className="hud-btn"
            title={voice.ttsEnabled ? 'Desactivar voz de respuesta' : 'Activar voz de respuesta'}
            style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 6px', border: '1px solid var(--border-subtle)', background: 'transparent', color: voice.ttsEnabled ? 'var(--accent-bright)' : 'var(--text-muted)', cursor: 'pointer' }}
          >
            {voice.ttsEnabled ? 'TTS ON' : 'TTS OFF'}
          </button>
        </div>
        <div className="separator" />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 24, marginBottom: 8 }}>
          {Array.from({ length: 20 }, (_, i) => (
            <EqualizerBar
              key={i}
              active={(voice.status === 'recording' && voice.level > i / 20) || (voice.status === 'speaking' && i % 3 !== 0)}
              delay={i * 0.05}
            />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onMouseDown={() => voice.status === 'standby' && voice.startRecording()}
            onMouseUp={() => voice.status === 'recording' && voice.stopRecording()}
            disabled={voice.status === 'transcribing'}
            title="Mantén presionado para hablar"
            style={{
              width: 32, height: 32, borderRadius: '50%',
              border: `1px solid ${voice.status === 'recording' ? 'var(--accent-bright)' : 'var(--border-subtle)'}`,
              background: voice.status === 'recording' ? 'var(--accent-dim)' : 'transparent',
              color: voice.status === 'recording' ? 'var(--accent-bright)' : 'var(--text-secondary)',
              cursor: voice.status === 'transcribing' ? 'wait' : 'pointer',
              fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {voice.status === 'recording'
              ? '●'
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
            }
          </button>
          <div>
            <div style={{ fontSize: 10, color: voice.status === 'standby' ? 'var(--text-secondary)' : 'var(--accent-bright)', letterSpacing: '0.1em' }}>
              {voice.status === 'recording' ? 'VOICE LINK · REC ●'
                : voice.status === 'transcribing' ? 'VOICE LINK · TRANSCRIBING…'
                : voice.status === 'speaking' ? 'VOICE LINK · SPEAKING'
                : 'VOICE LINK · STANDBY'}
            </div>
            <div className="label-sm" style={{ marginTop: 4 }}>
              HOLD V OR MIC TO TALK · ESC TO STOP
            </div>
          </div>
        </div>
      </div>

      {/* USAGE MATRIX */}
      <div className="hud-panel" style={{ padding: 12 }}>
        <Corner />
        <UsageHeatmap days={usageStats} />
      </div>

      {/* SYSTEM WIRE — actividad real del heartbeat/notices (antes noticias fake) */}
      <div className="hud-panel" style={{ padding: 12, flex: 1 }}>
        <Corner />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="label">SYSTEM WIRE</span>
          <span className="label-sm">HEARTBEAT.FEED · {(notices || []).length}</span>
        </div>
        <div className="separator" />
        <div style={{ height: 140, overflow: 'hidden', position: 'relative' }}>
          {(!notices || notices.length === 0) ? (
            <div className="label-sm" style={{ padding: '8px 0' }}>Sin actividad reciente</div>
          ) : (
            <div style={{ animation: 'ticker-scroll 20s linear infinite', position: 'absolute' }}>
              {/* Lista duplicada para loop continuo del ticker */}
              {[...notices.slice(0, 8), ...notices.slice(0, 8)].map((n, i) => (
                <div key={`${n.id}-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 10, fontSize: 10, lineHeight: 1.5 }}>
                  <span style={{ marginTop: 2 }}>
                    <NoticeIcon source={n.source} createdAt={n.createdAt} size={11} />
                  </span>
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      [{new Date(n.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase()}]
                    </span>
                    <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>
                      {cleanNoticeTitle(n.title)}{n.body ? ` — ${stripEmojis(n.body).slice(0, 120)}` : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
