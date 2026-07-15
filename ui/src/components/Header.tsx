import { useState, useEffect } from 'react';

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Header({ noticeCount = 0 }: { noticeCount?: number }) {
  const now = useNow();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  return (
    <header style={{
      padding: 'clamp(8px, 1vw, 12px) clamp(12px, 2vw, 24px)',
      borderBottom: '1px solid var(--border-subtle)',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 'clamp(2px, 0.3vw, 4px)',
    }}>
      {/* ═══ ROW 1: Title (left) + Clock (right) ═══ */}
      <div className="header-top-row" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        width: '100%',
      }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.3em', color: 'var(--accent-bright)' }}>
            E.S.C.A.R.L.A.T.A.
          </div>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)', marginTop: 2, maxWidth: 360, lineHeight: 1.6 }}>
            ENTIDAD SINTÉTICA DE COMANDO AUTÓNOMO<br />
            CON RAZONAMIENTO LÓGICO ASINCRÓNICO Y TOMA AUTÓNOMA DE DECISIONES
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="header-clock" style={{ fontSize: 'clamp(18px, 2.5vw, 30px)', fontWeight: 300, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.05em' }}>
            {hh}:{mm}<span style={{ color: 'var(--accent-bright)', animation: 'blink 1s step-end infinite' }}>:{ss}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginTop: 2 }}>
            {days[now.getDay()]} · {months[now.getMonth()]} {now.getDate()}
          </div>
        </div>
      </div>

      {/* ═══ ROW 2: Status line + CLEAR ALL (always centered) ═══ */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(24px, 3vw, 40px)', fontSize: 13, letterSpacing: '0.12em', color: 'var(--text-secondary)', textAlign: 'center', flexWrap: 'wrap' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} className="animate-pulse-opacity" />
          <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>CORE</span><span style={{ color: 'var(--text-muted)' }}>·</span><span style={{ color: 'var(--accent-text)' }}>IDLE</span></span>
          <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>LINK</span><span style={{ color: 'var(--text-muted)' }}>·</span><span style={{ color: 'var(--accent-text)' }}>ONLINE</span></span>
          <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>RUNNER</span><span style={{ color: 'var(--text-muted)' }}>·</span><span style={{ color: 'var(--accent-text)' }}>ALIVE</span></span>
          <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>QUEUE</span><span style={{ color: 'var(--text-muted)' }}>·</span><span style={{ color: 'var(--accent-text)' }}>0</span></span>
          {noticeCount > 0 && (
            <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>NOTICE</span><span style={{ color: 'var(--text-muted)' }}>·</span><span style={{ color: 'var(--status-critical, #ff4444)', fontWeight: 700 }}>{noticeCount}</span></span>
          )}
        </div>
        <button className="pill-btn" style={{ fontSize: 9, marginTop: 2 }}>
          CLEAR ALL
        </button>
      </div>
    </header>
  );
}
