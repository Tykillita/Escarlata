import type { LinkStatus } from '../types';

interface StatusRowProps {
  noticeCount?: number;
  provider: string;
  model: string;
  link: LinkStatus;
  runner: 'standby' | 'processing' | 'tool_call';
  queue: number;
  onOpenModelConfig: () => void;
  onOpenSync: () => void;
}

const linkColor = (ok: boolean) => ok ? 'var(--accent-bright)' : 'var(--accent-dim)';
const linkLabel = (ok: boolean) => ok ? 'ONLINE' : 'OFFLINE';

const runnerColor: Record<string, string> = {
  standby: 'var(--text-secondary)',
  processing: 'var(--accent-bright)',
  tool_call: 'var(--accent-bright)',
};

const runnerLabel: Record<string, string> = {
  standby: 'STANDBY',
  processing: 'PROCESSING',
  tool_call: 'TOOL_CALL',
};

export function StatusRow({ noticeCount = 0, provider, model, link, runner, queue, onOpenModelConfig, onOpenSync }: StatusRowProps) {
  const allOnline = link.ollama && link.whisper;
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(16px, 2vw, 28px)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-secondary)', textAlign: 'center', flexWrap: 'wrap' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: runner === 'processing' ? 'var(--accent-bright)' : 'var(--accent)', display: 'inline-block' }} className="animate-pulse-opacity" />
        <button
          onClick={onOpenModelConfig}
          title={`${provider.toUpperCase()} · Click to change provider/model`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', color: 'inherit', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
        >
          <span>CORE</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span style={{ color: 'var(--accent-bright)' }}>{model.toUpperCase()}</span>
        </button>
        <span title={`Ollama: ${link.ollama ? 'OK' : 'DOWN'} | Whisper: ${link.whisper ? 'OK' : 'DOWN'} | ngrok: ${link.ngrok ? 'ACTIVE' : 'INACTIVE'}`}
          style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span>LINK</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span style={{ color: linkColor(allOnline) }}>{linkLabel(allOnline)}</span>
        </span>
        <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span>RUNNER</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span style={{ color: runnerColor[runner] || 'var(--text-secondary)' }}>{runnerLabel[runner] || 'STANDBY'}</span>
        </span>
        <button onClick={onOpenSync} className="pill-btn" style={{fontSize:9,padding:'2px 6px'}}>SYNC</button>
        <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span>QUEUE</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span style={{ color: queue > 0 ? 'var(--accent-bright)' : 'var(--text-secondary)' }}>{queue}</span>
        </span>
        {noticeCount > 0 && (
          <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span>NOTICE</span>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>{noticeCount}</span>
          </span>
        )}
      </div>
    </div>
  );
}
