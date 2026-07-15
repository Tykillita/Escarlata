import { NoticeIcon, cleanNoticeTitle } from './NoticeIcon';

interface FloatingNoticeProps {
  title: string;
  subtitle: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  source?: string;
  createdAt?: string;
  onOpen?: () => void;
}

// Cards en las 4 esquinas del área central (el grafo grande llega cerca).
const posStyles: Record<string, React.CSSProperties> = {
  'top-left': { top: 56, left: 16 },
  'top-right': { top: 56, right: 16 },
  'bottom-left': { bottom: 72, left: 16 },
  'bottom-right': { bottom: 72, right: 16 },
};

// Tendón recto: rama corta que sale de la card hacia el grafo, con nodo diamante.
const TW = 64;
const TH = 40;

function Tendril({ position }: { position: string }) {
  const sx = position.includes('left') ? 1 : -1; // dirección x hacia el centro
  const sy = position.includes('top') ? 1 : -1;  // dirección y hacia el centro

  const start = { x: sx > 0 ? 0 : TW, y: sy > 0 ? 2 : TH - 2 };
  const end = { x: sx > 0 ? TW - 6 : 6, y: sy > 0 ? TH - 6 : 6 };

  const svgStyle: React.CSSProperties = {
    position: 'absolute',
    width: TW,
    height: TH,
    pointerEvents: 'none',
    overflow: 'visible',
    [position.includes('left') ? 'left' : 'right']: '100%',
    [position.includes('top') ? 'top' : 'bottom']: 0,
  };

  return (
    <svg className="notice-tendril" style={svgStyle} viewBox={`0 0 ${TW} ${TH}`} width={TW} height={TH}>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="var(--accent-line)" strokeWidth={1} />
      <rect
        className="tendril-node"
        x={end.x - 4}
        y={end.y - 4}
        width={8}
        height={8}
        fill="var(--accent-text)"
        transform={`rotate(45 ${end.x} ${end.y})`}
      />
    </svg>
  );
}

export function FloatingNotice({ title, subtitle, position, source = '', createdAt, onOpen }: FloatingNoticeProps) {
  const preview = subtitle.length > 48 ? subtitle.slice(0, 48).trimEnd() + '…' : subtitle;
  const cleanTitle = cleanNoticeTitle(title);
  return (
    <div className="animate-fade-in" onClick={onOpen} style={{
      position: 'absolute',
      ...posStyles[position],
      padding: '7px 10px',
      background: 'rgba(5, 5, 12, 0.85)',
      border: '1px solid var(--accent-line)',
      maxWidth: 168,
      cursor: onOpen ? 'pointer' : 'default',
      pointerEvents: 'auto',
    }}>
      {/* Bracket corners */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 7, height: 7, borderTop: '1px solid var(--accent-line)', borderLeft: '1px solid var(--accent-line)' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: 7, height: 7, borderTop: '1px solid var(--accent-line)', borderRight: '1px solid var(--accent-line)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, width: 7, height: 7, borderBottom: '1px solid var(--accent-line)', borderLeft: '1px solid var(--accent-line)' }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 7, height: 7, borderBottom: '1px solid var(--accent-line)', borderRight: '1px solid var(--accent-line)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <NoticeIcon source={source} createdAt={createdAt} />
        <span className="label" style={{ color: 'var(--accent-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanTitle}</span>
      </div>
      <div className="label-sm" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</div>

      <Tendril position={position} />
    </div>
  );
}
