type WindowAction = 'minimize' | 'toggle_maximize' | 'close';

/** Native-looking window controls, rendered only inside the hardened Electron bridge. */
export function DesktopWindowChrome() {
  if (!window.escarlataDesktop) return null;

  const control = (action: WindowAction) => {
    void window.escarlataDesktop?.command({ type: 'window_control', action });
  };

  return (
    <header className="desktop-window-chrome" aria-label="Controles de ventana">
      <div className="desktop-window-drag-region">
        <span className="desktop-window-title">ESCARLATA <i /> LOCAL</span>
      </div>
      <div className="desktop-window-controls" aria-label="Ventana">
        <button className="desktop-window-control minimize" type="button" onClick={() => control('minimize')} aria-label="Minimizar" title="Minimizar"><span /></button>
        <button className="desktop-window-control maximize" type="button" onClick={() => control('toggle_maximize')} aria-label="Maximizar o restaurar" title="Maximizar o restaurar"><span /></button>
        <button className="desktop-window-control close" type="button" onClick={() => control('close')} aria-label="Cerrar Escarlata" title="Cerrar Escarlata"><span /></button>
      </div>
    </header>
  );
}

export function DesktopWindowFrame({ children }: { children: React.ReactNode }) {
  if (!window.escarlataDesktop) return <>{children}</>;
  return <div className="desktop-window-frame"><DesktopWindowChrome /><div className="desktop-window-content">{children}</div></div>;
}
