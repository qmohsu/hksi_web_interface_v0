/**
 * React hook to connect the StreamClient to the Zustand store.
 *
 * Call once at the app root level. Manages WebSocket lifecycle.
 */

import { useEffect, useRef } from 'react';
import { StreamClient } from '../data/streamClient';
import { useStore } from '../stores/useStore';

/** Default WebSocket URL — uses the Vite proxy in development. */
function getDefaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

export function useStream(wsUrl?: string): void {
  const clientRef = useRef<StreamClient | null>(null);
  const handleMessage = useStore((s) => s.handleMessage);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);

  useEffect(() => {
    const url = wsUrl ?? getDefaultWsUrl();

    const client = new StreamClient({
      url,
      onMessage: handleMessage,
      onStatusChange: setConnectionStatus,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
    // Only reconnect if URL changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);
}
