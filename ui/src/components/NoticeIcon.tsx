// Iconos SVG para notificaciones (reemplazan emojis de los títulos).
// Se elige por `source` del notice; startup_briefing varía según la hora de creación.

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Sun() {
  return (
    <g {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </g>
  );
}

function Sunset() {
  return (
    <g {...stroke}>
      <path d="M17 18a5 5 0 0 0-10 0" />
      <path d="M12 9V3M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M16 5l-4 4-4-4" />
    </g>
  );
}

function Moon() {
  return (
    <g {...stroke}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </g>
  );
}

function Rocket() {
  return (
    <g {...stroke}>
      <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2-.7-3-.2z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.9 7.4-6 11a22.4 22.4 0 0 1-4 2z" />
      <path d="M9 12H4s.6-3.3 2-4.5c1.6-1.4 4 0 4 0M12 15v5s3.3-.6 4.5-2c1.4-1.6 0-4 0-4" />
    </g>
  );
}

function Clipboard() {
  return (
    <g {...stroke}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h6" />
    </g>
  );
}

function Chart() {
  return (
    <g {...stroke}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-6 4 3 5-8" />
    </g>
  );
}

function Bell() {
  return (
    <g {...stroke}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </g>
  );
}

function briefingIcon(createdAt?: string) {
  const h = createdAt ? new Date(createdAt).getHours() : 12;
  if (h >= 5 && h < 12) return <Sun />;
  if (h >= 12 && h < 18) return <Sun />;
  if (h >= 18 && h < 22) return <Sunset />;
  return <Moon />;
}

function pickIcon(source: string, createdAt?: string) {
  const s = source.toLowerCase();
  if (s.includes('briefing')) return briefingIcon(createdAt);
  if (s.includes('deploy')) return <Rocket />;
  if (s.includes('plan') || s.includes('todo') || s.includes('directive') || s.includes('follow')) return <Clipboard />;
  if (s.includes('metric') || s.includes('usage')) return <Chart />;
  return <Bell />;
}

// Quita emojis/pictogramas sobrantes al inicio del título (notices viejos con emoji)
export function cleanNoticeTitle(title: string): string {
  return title.replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍\s]+/gu, '').trim() || title;
}

export function NoticeIcon({ source, createdAt, size = 12 }: { source: string; createdAt?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color: 'var(--accent-text)', flexShrink: 0, display: 'block' }}
      aria-hidden
    >
      {pickIcon(source, createdAt)}
    </svg>
  );
}
