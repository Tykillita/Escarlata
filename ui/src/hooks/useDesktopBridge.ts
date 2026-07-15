import { useEffect, useRef, useCallback, useState } from 'react';
import type { WsMessage } from '../types';

type MessageHandler = (message: WsMessage) => void;

/** Typed Electron IPC bridge. The renderer never opens a localhost socket. */
export function useDesktopBridge(handlers: Record<string, MessageHandler>) {
  const handlersRef = useRef(handlers); handlersRef.current = handlers;
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authFailed] = useState(false);
  const send = useCallback((data: unknown) => { void window.escarlataDesktop?.command(data as never); }, []);

  useEffect(() => {
    const bridge = window.escarlataDesktop;
    if (!bridge) { setConnected(false); return; }
    setConnected(true);
    const off = bridge.onEvent((event) => {
      const msg = event as WsMessage;
      if (msg.type === 'auth_ok') setAuthenticated(true);
      handlersRef.current[msg.type]?.(msg);
    });
    void bridge.command({ type: 'get_state' });
    return () => { off(); setConnected(false); setAuthenticated(false); };
  }, []);

  return { send, connected, authenticated, authFailed };
}
