/**
 * Replay page — post-session review with timeline controls.
 *
 * Reuses the same RankingBoard + MapView as the live view, but feeds data
 * from a client-side replay engine that plays back session pack messages
 * through the store.
 *
 * Features:
 * - Timeline scrub bar with event markers
 * - Playback controls: play/pause, speed (0.5x–4x), jump-to-start
 * - Session selector
 * - Export buttons
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RankingBoard } from '../components/board/RankingBoard';
import { MapView } from '../components/map/MapView';
import { useStore } from '../stores/useStore';
import { ReplayEngine, type ReplayState } from '../data/replayEngine';
import {
  fetchSessions,
  exportSessionCsvUrl,
  exportSessionJsonUrl,
  downloadFile,
  type SessionMeta,
} from '../data/apiClient';
import { formatTime } from '../lib/formatters';
import type { WSMessage } from '../contracts/messages';

const SPEED_OPTIONS = [0.5, 1, 2, 4];

const EVENT_MARKER_COLORS: Record<string, string> = {
  CROSSING: '#ef4444',
  OCS: '#dc2626',
  RISK_ALERT: '#f97316',
  START_SIGNAL: '#3b82f6',
  DEVICE_OFFLINE: '#9ca3af',
  DEVICE_ONLINE: '#22c55e',
};

function formatElapsed(ms: number): string {
  const totalS = Math.floor(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function ReplayPage() {
  const [searchParams] = useSearchParams();
  const initialSession = searchParams.get('session');

  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>(initialSession ?? '');
  const [replayState, setReplayState] = useState<ReplayState | null>(null);
  const handleMessage = useStore((s) => s.handleMessage);

  // Create replay engine
  const engineRef = useRef<ReplayEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new ReplayEngine(
      (msg: WSMessage) => handleMessage(msg),
      (state: ReplayState) => setReplayState({ ...state })
    );
  }
  const engine = engineRef.current;

  // Load session list
  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch(console.error);
  }, []);

  // Auto-load session from URL param
  useEffect(() => {
    if (initialSession && engine) {
      setSelectedSession(initialSession);
      engine.load(initialSession);
    }
  }, [initialSession, engine]);

  const handleLoadSession = useCallback(() => {
    if (selectedSession && engine) {
      engine.load(selectedSession);
    }
  }, [selectedSession, engine]);

  const handlePlay = useCallback(() => engine?.play(), [engine]);
  const handlePause = useCallback(() => engine?.pause(), [engine]);
  const handleSetSpeed = useCallback(
    (speed: number) => engine?.setSpeed(speed),
    [engine]
  );

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!replayState || !engine) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ts = replayState.startTs + fraction * (replayState.endTs - replayState.startTs);
      engine.seek(ts);
    },
    [replayState, engine]
  );

  const handleJumpToStart = useCallback(() => {
    if (!replayState || !engine) return;
    engine.seek(replayState.startTs);
  }, [replayState, engine]);

  // Compute progress
  const progress = useMemo(() => {
    if (!replayState || replayState.endTs === replayState.startTs) return 0;
    return (
      ((replayState.currentTs - replayState.startTs) /
        (replayState.endTs - replayState.startTs)) *
      100
    );
  }, [replayState]);

  const elapsed = replayState
    ? replayState.currentTs - replayState.startTs
    : 0;
  const total = replayState
    ? replayState.endTs - replayState.startTs
    : 0;

  const isPlaying = replayState?.status === 'playing';
  const isReady =
    replayState?.status === 'ready' ||
    replayState?.status === 'paused' ||
    replayState?.status === 'playing' ||
    replayState?.status === 'ended';

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: session selector + export */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-slate-200">
        <label className="text-xs font-semibold text-slate-500 uppercase">Session:</label>
        <select
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
          className="text-sm border border-slate-300 rounded px-2 py-1 min-w-[200px]"
        >
          <option value="">— Select session —</option>
          {sessions.map((s) => (
            <option key={s.session_id} value={s.session_id}>
              {s.session_id}
              {s.duration_s != null ? ` (${formatElapsed(s.duration_s * 1000)})` : ''}
            </option>
          ))}
        </select>
        <button
          onClick={handleLoadSession}
          disabled={!selectedSession}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Load
        </button>

        {replayState?.status === 'loading' && (
          <span className="text-xs text-slate-400 animate-pulse">Loading...</span>
        )}
        {replayState?.status === 'error' && (
          <span className="text-xs text-red-500">{replayState.error}</span>
        )}

        <div className="flex-1" />

        {/* Export buttons */}
        {isReady && selectedSession && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => downloadFile(exportSessionCsvUrl(selectedSession), `${selectedSession}.csv`)}
              className="px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded border border-slate-300"
            >
              Export CSV
            </button>
            <button
              onClick={() => downloadFile(exportSessionJsonUrl(selectedSession), `${selectedSession}.json`)}
              className="px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded border border-slate-300"
            >
              Export JSON
            </button>
          </div>
        )}
      </div>

      {/* Main content: same board + map as live view */}
      {isReady ? (
        <div className="flex flex-1 gap-2 p-2 min-h-0">
          {/* Left pane: Ranking board */}
          <div className="w-2/5 min-w-[360px] flex-shrink-0">
            <RankingBoard />
          </div>
          {/* Right pane: Map */}
          <div className="flex-1">
            <MapView />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="text-center">
            <div className="text-6xl mb-4 text-slate-300">&#9654;</div>
            <h3 className="text-lg font-semibold text-slate-500">Session Replay</h3>
            <p className="text-sm text-slate-400 mt-2 max-w-md">
              Select a session from the dropdown above and click Load to begin.
              The replay uses the same dashboard as the live view.
            </p>
          </div>
        </div>
      )}

      {/* Timeline bar (always visible when loaded) */}
      {isReady && replayState && (
        <div className="bg-white border-t border-slate-200 px-4 py-2 space-y-1">
          {/* Progress bar with event markers */}
          <div
            className="relative h-6 bg-slate-100 rounded cursor-pointer group"
            onClick={handleSeek}
          >
            {/* Progress fill */}
            <div
              className="absolute inset-y-0 left-0 bg-blue-500/20 rounded-l"
              style={{ width: `${progress}%` }}
            />
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-blue-600 z-10"
              style={{ left: `${progress}%` }}
            >
              <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-blue-600 rounded-full" />
            </div>

            {/* Event markers */}
            {replayState.events.map((evt, i) => {
              const evtProgress =
                ((evt.ts_ms - replayState.startTs) /
                  (replayState.endTs - replayState.startTs)) *
                100;
              const color = EVENT_MARKER_COLORS[evt.event_kind] ?? '#9ca3af';
              return (
                <div
                  key={`${evt.ts_ms}-${i}`}
                  className="absolute top-0 bottom-0 w-1 rounded-full opacity-70 hover:opacity-100"
                  style={{
                    left: `${evtProgress}%`,
                    backgroundColor: color,
                  }}
                  title={`${evt.event_kind}: ${evt.name ?? evt.athlete_id ?? ''} @ ${formatTime(evt.ts_ms)}`}
                />
              );
            })}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              onClick={isPlaying ? handlePause : handlePlay}
              className="w-8 h-8 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 text-sm"
            >
              {isPlaying ? '\u275A\u275A' : '\u25B6'}
            </button>

            {/* Jump to start */}
            <button
              onClick={handleJumpToStart}
              className="text-xs text-slate-500 hover:text-slate-700"
              title="Jump to start"
            >
              |\u25C0
            </button>

            {/* Time display */}
            <span className="text-xs font-mono text-slate-600 min-w-[100px]">
              {formatElapsed(elapsed)} / {formatElapsed(total)}
            </span>

            {/* Speed selector */}
            <div className="flex items-center gap-1">
              {SPEED_OPTIONS.map((speed) => (
                <button
                  key={speed}
                  onClick={() => handleSetSpeed(speed)}
                  className={`px-2 py-0.5 text-[10px] rounded border ${
                    replayState.playbackSpeed === speed
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>

            {/* Status */}
            <span className="text-[10px] text-slate-400 ml-2">
              {replayState.status === 'ended' && 'Playback ended'}
              {replayState.status === 'paused' && 'Paused'}
              {replayState.status === 'playing' &&
                `Playing (${replayState.currentIndex}/${replayState.totalMessages})`}
            </span>

            <div className="flex-1" />

            {/* Message count */}
            <span className="text-[10px] text-slate-400">
              {replayState.totalMessages} messages · {replayState.events.length} events
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
