/**
 * Single WebSocket data ingestion module.
 *
 * All realtime data flows through this module — components MUST NOT
 * open their own WebSocket connections (rule 10-project-architecture).
 *
 * Handles: connect, reconnect with exponential backoff, message parsing,
 * connection status tracking, and dispatching to the store.
 */

import type { WSMessage } from '../contracts/messages';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface StreamClientOptions {
  /** WebSocket URL (e.g., "ws://localhost:8000/ws"). */
  url: string;
  /** Callback invoked on each parsed message. */
  onMessage: (msg: WSMessage) => void;
  /** Callback invoked on connection status change. */
  onStatusChange: (status: ConnectionStatus) => void;
  /** Minimum reconnect delay (ms). Default: 1000. */
  reconnectMinMs?: number;
  /** Maximum reconnect delay (ms). Default: 30000. */
  reconnectMaxMs?: number;
  /** Maximum time without any message before considering stale (ms). Default: 15000. */
  staleTimeoutMs?: number;
}

export class StreamClient {
  private ws: WebSocket | null = null;
  private options: Required<StreamClientOptions>;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private _lastSeq = 0;
  private _lastMessageTs = 0;
  private _messagesReceived = 0;
  private _parseErrors = 0;
  private _seqGaps = 0;
  private _disposed = false;

  constructor(options: StreamClientOptions) {
    this.options = {
      reconnectMinMs: 1000,
      reconnectMaxMs: 30000,
      staleTimeoutMs: 15000,
      ...options,
    };
  }

  /** Current connection status. */
  get status(): ConnectionStatus {
    return this._status;
  }

  /** Last received sequence number. */
  get lastSeq(): number {
    return this._lastSeq;
  }

  /** Timestamp of last received message. */
  get lastMessageTs(): number {
    return this._lastMessageTs;
  }

  /** Diagnostic counters. */
  get counters() {
    return {
      messagesReceived: this._messagesReceived,
      parseErrors: this._parseErrors,
      seqGaps: this._seqGaps,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /** Connect to the WebSocket server. */
  connect(): void {
    if (this._disposed) return;
    this.setStatus('connecting');
    this.createSocket();
  }

  /** Disconnect and stop reconnecting. */
  disconnect(): void {
    this._disposed = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  private createSocket(): void {
    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.resetStaleTimer();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.resetStaleTimer();
        this._lastMessageTs = Date.now();
        this.handleMessage(event.data as string);
      };

      this.ws.onclose = () => {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose will fire after onerror
      };
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as WSMessage;

      // Validate envelope
      if (!msg.type || !msg.schema_version || msg.seq === undefined) {
        this._parseErrors++;
        console.warn('[StreamClient] Malformed message envelope:', raw.slice(0, 100));
        return;
      }

      // Detect sequence gaps (never assume in-order delivery)
      if (this._lastSeq > 0 && msg.seq > this._lastSeq + 1) {
        this._seqGaps++;
        console.warn(
          `[StreamClient] Sequence gap: expected ${this._lastSeq + 1}, got ${msg.seq}`
        );
      }
      this._lastSeq = msg.seq;
      this._messagesReceived++;

      this.options.onMessage(msg);
    } catch {
      this._parseErrors++;
      console.warn('[StreamClient] Failed to parse message:', raw.slice(0, 100));
    }
  }

  private scheduleReconnect(): void {
    if (this._disposed) return;
    this.clearTimers();

    const delay = Math.min(
      this.options.reconnectMinMs * Math.pow(2, Math.min(this.reconnectAttempts, 10)),
      this.options.reconnectMaxMs
    );
    this.reconnectAttempts++;

    console.info(`[StreamClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.setStatus('connecting');
      this.createSocket();
    }, delay);
  }

  private resetStaleTimer(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      console.warn('[StreamClient] Connection stale — no messages for', this.options.staleTimeoutMs, 'ms');
    }, this.options.staleTimeoutMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.options.onStatusChange(status);
    }
  }
}
