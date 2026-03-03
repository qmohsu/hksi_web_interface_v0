/**
 * React hook to connect the StreamClient to the Zustand store.
 *
 * Call once at the app root level. Manages WebSocket lifecycle.
 * Messages are only processed when liveMode is true (disabled during replay).
 */

import { useEffect, useRef, useCallback } from 'react';
import { StreamClient } from '../data/streamClient';
import { useStore } from '../stores/useStore';
import type { WSMessage } from '../contracts/messages';

/** Default WebSocket URL — uses the Vite proxy in development. */
function getDefaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

export function useStream(wsUrl?: string): void {
  const clientRef = useRef<StreamClient | null>(null);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const handleMessage = useStore((s) => s.handleMessage);

  // Create a callback that reads liveMode directly from store on each call
  const onMessage = useCallback((msg: WSMessage) => {
    const liveMode = useStore.getState().liveMode;
    if (liveMode) {
      handleMessage(msg);
    }
  }, [handleMessage]);

  useEffect(() => {
    const url = wsUrl ?? getDefaultWsUrl();

    const client = new StreamClient({
      url,
      onMessage,
      onStatusChange: setConnectionStatus,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
    // Re-create client when URL changes
  }, [wsUrl, setConnectionStatus, onMessage]);
}
