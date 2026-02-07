/**
 * Client-side replay engine.
 *
 * Fetches session messages from the relay API and plays them back
 * through the store's handleMessage, reusing the same UI pipeline
 * as the live view.
 *
 * Supports:
 * - Play / pause
 * - Playback speed: 0.5x, 1x, 2x, 4x
 * - Seek to arbitrary position
 * - Event markers (crossing, OCS, start signal)
 */

import type { WSMessage } from '../contracts/messages';
import { fetchSessionMessages, type SessionMessagesResponse } from './apiClient';

export type ReplayStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

export interface ReplayEvent {
  ts_ms: number;
  event_kind: string;
  athlete_id: string | null;
  name: string | null;
  index: number;
}

export interface ReplayState {
  status: ReplayStatus;
  sessionId: string | null;
  totalMessages: number;
  currentIndex: number;
  startTs: number;
  endTs: number;
  currentTs: number;
  playbackSpeed: number;
  events: ReplayEvent[];
  error: string | null;
}

export type ReplayCallback = (msg: WSMessage) => void;
export type ReplayStateCallback = (state: ReplayState) => void;

export class ReplayEngine {
  private messages: Array<Record<string, unknown>> = [];
  private state: ReplayState;
  private onMessage: ReplayCallback;
  private onStateChange: ReplayStateCallback;
  private animFrame: number | null = null;
  private wallStartTime: number = 0;
  private msgStartTs: number = 0;

  constructor(onMessage: ReplayCallback, onStateChange: ReplayStateCallback) {
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;
    this.state = this.initialState();
  }

  private initialState(): ReplayState {
    return {
      status: 'idle',
      sessionId: null,
      totalMessages: 0,
      currentIndex: 0,
      startTs: 0,
      endTs: 0,
      currentTs: 0,
      playbackSpeed: 1,
      events: [],
      error: null,
    };
  }

  private emit(): void {
    this.onStateChange({ ...this.state });
  }

  /** Load a session for replay. */
  async load(sessionId: string): Promise<void> {
    this.stop();
    this.state = { ...this.initialState(), status: 'loading', sessionId };
    this.emit();

    try {
      const data: SessionMessagesResponse = await fetchSessionMessages(sessionId);
      this.messages = data.messages;

      if (this.messages.length === 0) {
        this.state = { ...this.state, status: 'error', error: 'No messages in session' };
        this.emit();
        return;
      }

      const startTs = this.messages[0].ts_ms as number;
      const endTs = this.messages[this.messages.length - 1].ts_ms as number;

      // Extract event markers
      const events: ReplayEvent[] = [];
      this.messages.forEach((msg, idx) => {
        if (msg.type === 'event') {
          const payload = msg.payload as Record<string, unknown>;
          events.push({
            ts_ms: msg.ts_ms as number,
            event_kind: (payload.event_kind as string) ?? 'UNKNOWN',
            athlete_id: (payload.athlete_id as string) ?? null,
            name: (payload.name as string) ?? null,
            index: idx,
          });
        }
      });

      this.state = {
        ...this.state,
        status: 'ready',
        totalMessages: this.messages.length,
        currentIndex: 0,
        startTs,
        endTs,
        currentTs: startTs,
        events,
        error: null,
      };
      this.emit();
    } catch (e) {
      this.state = {
        ...this.state,
        status: 'error',
        error: e instanceof Error ? e.message : 'Failed to load session',
      };
      this.emit();
    }
  }

  /** Start or resume playback. */
  play(): void {
    if (this.state.status === 'ended') {
      // Restart from beginning
      this.state.currentIndex = 0;
      this.state.currentTs = this.state.startTs;
    }

    if (
      this.state.status !== 'ready' &&
      this.state.status !== 'paused' &&
      this.state.status !== 'ended'
    ) {
      return;
    }

    this.state.status = 'playing';
    this.wallStartTime = performance.now();
    this.msgStartTs = this.state.currentTs;
    this.emit();
    this.tick();
  }

  /** Pause playback. */
  pause(): void {
    if (this.state.status !== 'playing') return;
    this.state.status = 'paused';
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.emit();
  }

  /** Set playback speed. */
  setSpeed(speed: number): void {
    const wasPlaying = this.state.status === 'playing';
    if (wasPlaying) {
      this.pause();
    }
    this.state.playbackSpeed = speed;
    this.emit();
    if (wasPlaying) {
      this.play();
    }
  }

  /** Seek to a specific timestamp. */
  seek(ts_ms: number): void {
    const targetTs = Math.max(this.state.startTs, Math.min(ts_ms, this.state.endTs));

    // Find the closest message index at or before targetTs
    let idx = 0;
    for (let i = 0; i < this.messages.length; i++) {
      if ((this.messages[i].ts_ms as number) <= targetTs) {
        idx = i;
      } else {
        break;
      }
    }

    const wasPlaying = this.state.status === 'playing';
    if (wasPlaying) {
      if (this.animFrame) {
        cancelAnimationFrame(this.animFrame);
        this.animFrame = null;
      }
    }

    this.state.currentIndex = idx;
    this.state.currentTs = targetTs;

    // Replay all messages up to the seek point to rebuild state
    for (let i = 0; i <= idx; i++) {
      this.onMessage(this.messages[i] as unknown as WSMessage);
    }

    if (wasPlaying) {
      this.wallStartTime = performance.now();
      this.msgStartTs = targetTs;
      this.state.status = 'playing';
      this.emit();
      this.tick();
    } else {
      this.state.status = idx >= this.messages.length - 1 ? 'ended' : 'paused';
      this.emit();
    }
  }

  /** Stop and reset. */
  stop(): void {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.messages = [];
    this.state = this.initialState();
    this.emit();
  }

  /** Internal playback tick — dispatches messages whose ts_ms has been reached. */
  private tick = (): void => {
    if (this.state.status !== 'playing') return;

    const elapsed = (performance.now() - this.wallStartTime) * this.state.playbackSpeed;
    const currentTs = this.msgStartTs + elapsed;
    this.state.currentTs = Math.min(currentTs, this.state.endTs);

    // Dispatch all messages up to currentTs
    while (this.state.currentIndex < this.messages.length) {
      const msg = this.messages[this.state.currentIndex];
      const msgTs = msg.ts_ms as number;

      if (msgTs <= currentTs) {
        this.onMessage(msg as unknown as WSMessage);
        this.state.currentIndex++;
      } else {
        break;
      }
    }

    // Check if we've reached the end
    if (this.state.currentIndex >= this.messages.length) {
      this.state.status = 'ended';
      this.state.currentTs = this.state.endTs;
      this.emit();
      return;
    }

    this.emit();
    this.animFrame = requestAnimationFrame(this.tick);
  };

  /** Get the current progress as a fraction (0-1). */
  get progress(): number {
    const range = this.state.endTs - this.state.startTs;
    if (range <= 0) return 0;
    return (this.state.currentTs - this.state.startTs) / range;
  }
}
