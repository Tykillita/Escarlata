export function PerspectiveGrid() {
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < 30; i++) {
    const y = 100 + i * 2;
    lines.push(
      <line key={`h${i}`} x1={0} y1={y} x2={100} y2={y} stroke="currentColor" strokeOpacity={0.06 + i * 0.002} strokeWidth={0.5} />
    );
  }
  for (let i = -15; i <= 15; i++) {
    const x = 50 + i * 3;
    const w = Math.abs(i) * 0.3 + 0.5;
    lines.push(
      <line key={`v${i}`} x1={x} y1={100} x2={50 + i * 6} y2={158} stroke="currentColor" strokeOpacity={0.04 + Math.abs(i) * 0.002} strokeWidth={w} />
    );
  }
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, height: 80, overflow: 'hidden', pointerEvents: 'none', zIndex: -1,
      color: 'var(--accent)',
    }}>
      <svg viewBox="0 0 100 160" preserveAspectRatio="xMidYMax slice" style={{ width: '100%', height: '100%' }}>
        {lines}
      </svg>
    </div>
  );
}
