import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#050508', color: 'rgba(255,255,255,0.7)', fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12, flexDirection: 'column', gap: 12, padding: 24,
        }}>
          <div style={{ color: 'var(--accent-bright, #ff6b6b)', fontSize: 10, letterSpacing: '0.2em' }}>CHAT ERROR</div>
          <div style={{ fontSize: 11, textAlign: 'center', maxWidth: 400, lineHeight: 1.5 }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
              color: 'rgba(255,255,255,0.6)', fontFamily: 'inherit', fontSize: 10,
              padding: '6px 16px', cursor: 'pointer', marginTop: 8,
              letterSpacing: '0.1em',
            }}
          >RETRY</button>
        </div>
      );
    }
    return this.props.children;
  }
}
