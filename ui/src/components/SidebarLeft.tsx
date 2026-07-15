import { useEffect, useRef, useState } from 'react';
import type { VaultFile, MemoryFact, MemoryCandidate, DirectiveItem, VitalMetric, VitalsProvider } from '../types';

function LogoLauncher({ onOpenChat, onOpenProviders, onOpenSync, onOpenActivity, onOpenAppSettings }: { onOpenChat: () => void; onOpenProviders: () => void; onOpenSync: () => void; onOpenActivity: () => void; onOpenAppSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  const openDestination = (destination: () => void) => { setOpen(false); destination(); };
  return (
    <div ref={rootRef} className="logo-block logo-launcher">
      <button type="button" className="logo-launcher-trigger" onClick={() => setOpen(value => !value)} aria-label="Abrir navegación rápida" aria-expanded={open} aria-haspopup="menu">
        <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '0.25em', color: 'var(--accent-bright)' }}>E.S.C.A.R.L.A.T.A</span>
        <span style={{ display: 'block', fontSize: 8, letterSpacing: '0.12em', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
          ENTIDAD SINTÉTICA DE COMANDO AUTÓNOMO<br />
          CON RAZONAMIENTO LÓGICO ASINCRÓNICO Y TOMA AUTÓNOMA DE DECISIONES
        </span>
      </button>
      {open && (
        <div className="logo-command-menu" role="menu" aria-label="Navegación rápida">
          <div className="logo-command-menu-label">NAVEGACIÓN RÁPIDA</div>
          <button type="button" role="menuitem" onClick={() => openDestination(onOpenChat)}><span>01</span> Abrir chat</button>
          <button type="button" role="menuitem" onClick={() => openDestination(onOpenAppSettings)}><span>02</span> Configuración de la app</button>
          <button type="button" role="menuitem" onClick={() => openDestination(onOpenProviders)}><span>03</span> Proveedores y modelos</button>
          <button type="button" role="menuitem" onClick={() => openDestination(onOpenSync)}><span>04</span> Sincronización</button>
          <button type="button" role="menuitem" onClick={() => openDestination(onOpenActivity)}><span>05</span> Actividad</button>
        </div>
      )}
    </div>
  );
}

function Corner() {
  return (<>
    <div className="hud-corner tl" />
    <div className="hud-corner tr" />
    <div className="hud-corner bl" />
    <div className="hud-corner br" />
  </>);
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 220; const h = 30;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block', marginTop: 4 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} strokeOpacity={0.6} />
    </svg>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div style={{ width: 220, height: 10, border: '1px solid var(--border-subtle)', marginTop: 4 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, percent))}%`, height: '100%', background: 'var(--accent-dim)' }} />
    </div>
  );
}

function PlanAllowanceGrid({ metrics, plan }: { metrics: VitalMetric[]; plan: string }) {
  return (
    <div style={{ margin: '2px 0 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span className="label">{plan} ALLOWANCES</span>
        <span className="label-sm">PLAN CAPS · NOT LIVE</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border-subtle)', borderLeft: '1px solid var(--border-subtle)' }}>
        {metrics.map(metric => (
          <div key={metric.label} style={{ minWidth: 0, padding: '7px 7px 8px', borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="label-sm" style={{ fontSize: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{metric.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2, minWidth: 0 }}>
              <span style={{ fontSize: 18, lineHeight: 1, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>{metric.value}</span>
              <span style={{ fontSize: 6.5, lineHeight: 1.2, color: 'var(--accent-text)', letterSpacing: '0.08em' }}>{metric.subvalue}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenBreakdownGrid({ metrics }: { metrics: VitalMetric[] }) {
  const cacheRate = metrics.find(metric => metric.label === 'CACHE HIT RATE');
  const tokenParts = metrics.filter(metric => metric.label !== 'CACHE HIT RATE');
  return (
    <div style={{ margin: '3px 0 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span className="label">TOKEN FLOW</span>
        <span className="label-sm">LOCAL · CODEX LOGS</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border-subtle)', borderLeft: '1px solid var(--border-subtle)' }}>
        {tokenParts.map(metric => (
          <div key={metric.label} style={{ minWidth: 0, padding: '7px 7px 8px', borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="label-sm" style={{ fontSize: 7 }}>{metric.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 3 }}>
              <span style={{ fontSize: 18, lineHeight: 1, color: metric.value === 'N/A' ? 'var(--text-muted)' : 'var(--text-primary)', letterSpacing: '-0.04em' }}>{metric.value}</span>
              {metric.subvalue && <span style={{ fontSize: 6, color: 'var(--text-muted)', letterSpacing: '0.07em' }}>{metric.subvalue}</span>}
            </div>
          </div>
        ))}
      </div>
      {cacheRate && (
        <div style={{ padding: '7px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="label-sm">CACHE HIT RATE</span>
            <span style={{ fontSize: 10, color: 'var(--accent-bright)', letterSpacing: '0.05em' }}>{cacheRate.value}</span>
          </div>
          <ProgressBar percent={cacheRate.bar ?? 0} />
        </div>
      )}
    </div>
  );
}

function VitalsProviderMenu({ current, onSelect }: { current: VitalsProvider; onSelect: (provider: VitalsProvider) => void }) {
  return (
    <div style={{ border: '1px solid var(--accent-dim)', background: 'rgba(5,5,8,0.98)', padding: 4, marginTop: -8, marginBottom: 10 }}>
      {([
        ['anthropic', 'ANTHROPIC · CLAUDE'],
        ['openai', 'OPENAI · CHATGPT'],
      ] as const).map(([provider, label]) => (
        <button
          type="button"
          key={provider}
          onClick={() => onSelect(provider)}
          className="label-sm"
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '6px 7px', border: 0,
            background: provider === current ? 'var(--accent-faint)' : 'transparent',
            color: provider === current ? 'var(--accent-text)' : 'var(--text-secondary)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {provider === current ? '● ' : '○ '}{label}
        </button>
      ))}
    </div>
  );
}

function ProviderSelectorButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="label-sm"
      onClick={onClick}
      title="Cambiar provider de vitals"
      style={{
        display: 'block', width: '100%', textAlign: 'left', marginTop: 2, padding: '7px 0 1px',
        border: 0, borderTop: '1px solid var(--border-subtle)', background: 'transparent',
        color: 'var(--accent-text)', cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      {label} ▾
    </button>
  );
}

function Metric({ label, value, trend, delta, period, note, sparkData, bar, subvalue, visual = 'spark', onNoteClick }: {
  label: string; value: string; trend?: 'up' | 'down'; delta?: string; period?: string; note?: string; sparkData: number[]; bar?: number; subvalue?: string; visual?: 'spark' | 'none'; onNoteClick?: () => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent-dim)', display: 'inline-block' }} />
          <span className="label">{label}</span>
        </div>
        {period && <span className="label-sm">{period}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
        <span className="number-lg">{value}</span>
        {trend && delta && (
          <span style={{ fontSize: 10, color: trend === 'up' ? 'var(--accent-bright)' : 'var(--text-secondary)', letterSpacing: '0.05em' }}>
            {trend === 'up' ? '▲' : '▼'} {delta}
            {period && <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>/{period}</span>}
          </span>
        )}
        {subvalue && (
          <span style={{ fontSize: 8, color: 'var(--accent-text)', letterSpacing: '0.11em', marginLeft: 'auto' }}>
            {subvalue}
          </span>
        )}
      </div>
      {bar !== undefined ? <ProgressBar percent={bar} /> : visual === 'spark' ? <Sparkline data={sparkData} color="var(--accent)" /> : null}
      {note && (onNoteClick ? (
        <button
          type="button"
          className="label-sm"
          onClick={onNoteClick}
          title="Cambiar provider de vitals"
          style={{ marginTop: 1, padding: 0, border: 0, background: 'transparent', color: 'var(--accent-text)', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {note} ▾
        </button>
      ) : <div className="label-sm" style={{ marginTop: 1 }}>{note}</div>)}
    </div>
  );
}

const sparkDefaults = [12, 18, 14, 22, 30, 26, 35, 40, 38, 42, 48, 52, 58, 54, 62, 60, 68, 72, 70, 78];

function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const half = Math.floor((maxLen - 1) / 2);
  return text.slice(0, half) + '…' + text.slice(text.length - half);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function SidebarLeft({ vaultFiles, facts, directives, vitals, vitalsProvider, vitalsError, vitalsCached, vitalsUpdatedAt, onVitalsProviderChange, onDeleteMemory, memoryCandidates = [], onReviewCandidate, onOpenChat, onOpenProviders, onOpenSync, onOpenActivity, onOpenAppSettings }: {
  vaultFiles: VaultFile[];
  facts: MemoryFact[];
  directives: DirectiveItem[];
  vitals: VitalMetric[];
  vitalsProvider: VitalsProvider;
  vitalsError?: string;
  vitalsCached?: boolean;
  vitalsUpdatedAt?: string;
  onVitalsProviderChange: (provider: VitalsProvider) => void;
  onDeleteMemory?: (id: string) => void;
  memoryCandidates?: MemoryCandidate[];
  onReviewCandidate?: (id: string, decision: 'approved' | 'rejected') => void;
  onOpenChat: () => void;
  onOpenProviders: () => void;
  onOpenSync: () => void;
  onOpenActivity: () => void;
  onOpenAppSettings: () => void;
}) {
  const [vitalsMenuOpen, setVitalsMenuOpen] = useState(false);
  const placeholderLabels = vitalsProvider === 'openai'
    ? ['WEEK · CODEX', 'ACCOUNT TIER', 'TOKEN TELEMETRY', 'MODEL']
    : ['SESSION (5H)', 'WEEK · ALL MODELS', 'TOKENS TODAY', 'COST TODAY', 'BURN RATE'];
  const accountTier = vitals.find(metric => metric.label === 'ACCOUNT TIER')?.value || 'PLUS';

  const selectVitalsProvider = (provider: VitalsProvider) => {
    onVitalsProviderChange(provider);
    setVitalsMenuOpen(false);
  };

  return (
    <div className="sidebar-left">
      {/* Logo / title */}
      <LogoLauncher onOpenChat={onOpenChat} onOpenProviders={onOpenProviders} onOpenSync={onOpenSync} onOpenActivity={onOpenActivity} onOpenAppSettings={onOpenAppSettings} />
      <div className="separator" style={{ margin: '8px 0' }} />

      {/* SYSTEM VITALS */}
      <div className="hud-panel" style={{ padding: 12 }}>
        <Corner />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="label">SYSTEM VITALS</span>
          <span className="label-sm">{vitalsProvider === 'openai' ? `CHATGPT.${accountTier}` : 'CLAUDE.USAGE'}</span>
        </div>
        <div className="separator" />
        {vitalsCached && (
          <div className="label-sm" style={{ color: 'var(--accent-text)', marginBottom: 8 }}>
            CACHÉ LOCAL{vitalsUpdatedAt ? ` · ${new Date(vitalsUpdatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}
          </div>
        )}
        {vitalsError && <div className="label-sm" style={{ color: 'var(--text-muted)', marginBottom: 8 }}>{vitalsError}</div>}
        {vitals.length === 0 ? (
          placeholderLabels.map(label => label === 'MODEL' ? (
            <div key={label}>
              <ProviderSelectorButton label="MODEL · CODEX · PLUS" onClick={() => setVitalsMenuOpen(open => !open)} />
              {vitalsMenuOpen && <VitalsProviderMenu current={vitalsProvider} onSelect={selectVitalsProvider} />}
            </div>
          ) : (
            <div key={label} style={{ position: 'relative' }}>
              <Metric
                label={label}
                value="—"
                note={label === 'BURN RATE' ? (vitalsProvider === 'openai' ? 'MODEL · CODEX' : 'MODEL · CLAUDE') : undefined}
                onNoteClick={label === 'BURN RATE' ? () => setVitalsMenuOpen(open => !open) : undefined}
                visual={vitalsProvider === 'openai' && label !== 'WEEK · CODEX' ? 'none' : 'spark'}
                sparkData={sparkDefaults.map(() => 0)}
              />
            </div>
          ))
        ) : (
          vitals.map((m, index) => {
            if (m.label === 'ACCOUNT TIER') return null;
            if (m.group === 'plan_allowance') {
              if (index > 0 && vitals[index - 1]?.group === 'plan_allowance') return null;
              const allowanceMetrics = vitals.slice(index).filter(metric => metric.group === 'plan_allowance');
              return <PlanAllowanceGrid key="plan-allowances" metrics={allowanceMetrics} plan={accountTier} />;
            }
            if (m.group === 'token_breakdown') {
              if (index > 0 && vitals[index - 1]?.group === 'token_breakdown') return null;
              const tokenMetrics = vitals.slice(index).filter(metric => metric.group === 'token_breakdown');
              return <TokenBreakdownGrid key="token-breakdown" metrics={tokenMetrics} />;
            }
            if (m.group === 'provider_selector') {
              return (
                <div key="provider-selector">
                  <ProviderSelectorButton label={m.note || `MODEL · ${m.value.toUpperCase()} · ${accountTier}`} onClick={() => setVitalsMenuOpen(open => !open)} />
                  {vitalsMenuOpen && <VitalsProviderMenu current={vitalsProvider} onSelect={selectVitalsProvider} />}
                </div>
              );
            }
            return (
            <div key={m.label} style={{ position: 'relative' }}>
              <Metric
                label={m.label}
                value={m.value}
                trend={m.trend}
                delta={m.delta}
                period={m.period}
                note={m.note}
                sparkData={m.sparkData}
                bar={m.bar}
                subvalue={m.subvalue}
                visual={m.visual}
                onNoteClick={m.label === 'BURN RATE' ? () => setVitalsMenuOpen(open => !open) : undefined}
              />
              {m.label === 'BURN RATE' && vitalsMenuOpen && (
                <VitalsProviderMenu current={vitalsProvider} onSelect={selectVitalsProvider} />
              )}
            </div>
            );
          })
        )}
      </div>

      {/* DIRECTIVES */}
      <div className="hud-panel" style={{ padding: 12 }}>
        <Corner />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="label">DIRECTIVES</span>
          <span className="label-sm">PENDIENTES</span>
        </div>
        <div className="separator" />
        {directives.length === 0 ? (
          <div className="label-sm" style={{ padding: '8px 0' }}>No directives found</div>
        ) : (
          directives.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: i < directives.length - 1 ? 10 : 0, alignItems: 'flex-start' }}>
              <div style={{
                width: 10, height: 10, marginTop: 3, flexShrink: 0,
                border: '1px solid var(--accent-dim)',
                background: item.checked ? 'var(--accent-dim)' : 'transparent',
              }} />
              <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{item.text}</span>
            </div>
          ))
        )}
      </div>

      {/* MEMORY — hechos de largo plazo del agente, con borrado */}
      <div className="hud-panel" style={{ padding: 12 }}>
        <Corner />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="label">MEMORY</span>
          <span className="label-sm">FACTS · {facts.length}</span>
        </div>
        <div className="separator" />
        {facts.length === 0 ? (
          <div className="label-sm" style={{ padding: '8px 0' }}>Sin memorias guardadas</div>
        ) : (
          <div style={{ maxHeight: 180, overflow: 'auto' }}>
            {facts.map((f, i) => (
              <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', borderBottom: i < facts.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', flex: 1 }} title={f.category}>
                  {f.content}
                </span>
                {onDeleteMemory && (
                  <button
                    onClick={() => onDeleteMemory(f.id)}
                    title="Olvidar"
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: 12, lineHeight: 1.4, flexShrink: 0 }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {memoryCandidates.length > 0 && onReviewCandidate && (
          <>
            <div className="separator" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="label-sm" title="Propuestas de Amatista tras analizar tus conversaciones — nada se guarda sin tu visto bueno">
                POR REVISAR · {memoryCandidates.length}
              </span>
            </div>
            <div style={{ maxHeight: 140, overflow: 'auto' }}>
              {memoryCandidates.map((c, i) => (
                <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', borderBottom: i < memoryCandidates.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', flex: 1 }} title={c.category}>
                    {c.content}
                  </span>
                  <button
                    onClick={() => onReviewCandidate(c.id, 'approved')}
                    title="Guardar en memoria"
                    style={{ background: 'none', border: 'none', color: 'var(--accent-bright)', cursor: 'pointer', padding: '0 2px', fontSize: 12, lineHeight: 1.4, flexShrink: 0 }}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => onReviewCandidate(c.id, 'rejected')}
                    title="Descartar propuesta"
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: 12, lineHeight: 1.4, flexShrink: 0 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* DOCUMENTS */}
      <div className="hud-panel" style={{ padding: 12 }}>
        <Corner />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="label">DOCUMENTS</span>
          <span className="label-sm">VAULT · {vaultFiles.length}</span>
        </div>
        <div className="separator" />
        {vaultFiles.length === 0 ? (
          <div className="label-sm" style={{ padding: '8px 0' }}>No vault files found</div>
        ) : (
          vaultFiles.slice(0, 8).map((file, i) => (
            <div key={file.path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: i < Math.min(vaultFiles.length, 8) - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
              <span style={{ fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160, textAlign: 'left' }} title={file.path}>{truncateMiddle(file.path, 24)}</span>
              <span className="label-sm">{timeAgo(file.modifiedAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
