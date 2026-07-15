import type { VaultFile, MemoryFact, ToolDef } from '../types';

export function HeroMetric({ vaultFiles, facts, tools }: { vaultFiles: VaultFile[]; facts: MemoryFact[]; tools: ToolDef[] }) {
  return (
    <div style={{ textAlign: 'center', padding: '0 40px 20px', zIndex: 2, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} className="animate-pulse-opacity" />
        <span className="label">PRIMARY DIRECTIVE · OBSIDIAN VAULT</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
        <span className="number-xl">{vaultFiles.length.toLocaleString()}</span>
        <span className="label" style={{ fontSize: 12, color: 'var(--text-muted)' }}>NOTES</span>
      </div>

      <div style={{ width: 280, margin: '10px auto', height: 2, background: 'var(--border-subtle)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(facts.length * 10, 100)}%`, height: '100%', background: 'var(--accent)', opacity: 0.7 }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span>FACTS <span style={{ color: 'var(--accent-text)' }}>{facts.length}</span></span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span>TOOLS <span style={{ color: 'var(--accent-text)' }}>{tools.length}</span></span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span>VAULT <span style={{ color: 'var(--accent-text)' }}>{vaultFiles.length}</span></span>
      </div>

      <div className="label-sm" style={{ marginTop: 6 }}>
        {vaultFiles.length > 0 ? `last modified · ${vaultFiles[0].path}` : 'no vault files found'}
      </div>
    </div>
  );
}
