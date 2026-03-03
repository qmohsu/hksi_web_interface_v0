/**
 * Live page — the primary coaching view.
 *
 * Two-pane layout matching the stakeholder GUI pattern:
 *   Left: RankingBoard (athlete list / start board) + AlertsPanel
 *   Right: MapView (tracks + labels + start line)
 *   Toasts: overlay for real-time event notifications
 *   Bottom: Recording control bar
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RankingBoard } from '../components/board/RankingBoard';
import { MapView } from '../components/map/MapView';
import { AlertsPanel } from '../components/alerts/AlertsPanel';
import { AlertToast } from '../components/alerts/AlertToast';
import { startSession, stopSession, fetchHealth } from '../data/apiClient';
import { useStore } from '../stores/useStore';

interface RecordingState {
  isRecording: boolean;
  sessionId: string | null;
  messageCount: number;
  startTime: number | null;
}

function formatDuration(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function LivePage() {
  const [recording, setRecording] = useState<RecordingState>({
    isRecording: false,
    sessionId: null,
    messageCount: 0,
    startTime: null,
  });
  const [elapsed, setElapsed] = useState('00:00');
  const [isLoading, setIsLoading] = useState(false);
  const heartbeat = useStore((s) => s.heartbeat);
  
  // Refs for timer and polling
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll recording status from health endpoint
  const pollRecordingStatus = useCallback(async () => {
    try {
      const health = await fetchHealth();
      const isRecording = health.recording as boolean;
      const sessionId = health.recording_session as string | null;
      const messageCount = health.message_count as number | undefined;
      
      setRecording((prev) => ({
        isRecording,
        sessionId,
        messageCount: messageCount ?? prev.messageCount,
        startTime: isRecording && !prev.startTime ? Date.now() : prev.startTime,
      }));
    } catch {
      // Silently fail - we'll try again on next poll
    }
  }, []);

  // Initial poll and setup polling interval
  useEffect(() => {
    pollRecordingStatus();
    pollRef.current = setInterval(pollRecordingStatus, 2000);
    
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollRecordingStatus]);

  // Update elapsed time display
  useEffect(() => {
    if (recording.isRecording && recording.startTime) {
      timerRef.current = setInterval(() => {
        setElapsed(formatDuration(recording.startTime!));
      }, 1000);
    } else {
      setElapsed('00:00');
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recording.isRecording, recording.startTime]);

  const handleStartRecording = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await startSession();
      setRecording({
        isRecording: true,
        sessionId: result.session_id,
        messageCount: 0,
        startTime: Date.now(),
      });
    } catch (err) {
      console.error('Failed to start recording:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleStopRecording = useCallback(async () => {
    setIsLoading(true);
    try {
      await stopSession();
      setRecording({
        isRecording: false,
        sessionId: null,
        messageCount: 0,
        startTime: null,
      });
      setElapsed('00:00');
    } catch (err) {
      console.error('Failed to stop recording:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Main content area */}
      <div className="flex flex-1 gap-2 p-2 min-h-0">
        {/* Left pane: Ranking board + Alerts (~40% width) */}
        <div className="w-2/5 min-w-[360px] flex-shrink-0 flex flex-col gap-2">
          <div className="flex-1 min-h-0">
            <RankingBoard />
          </div>
          <AlertsPanel />
        </div>

        {/* Right pane: Map (~60% width) */}
        <div className="flex-1">
          <MapView />
        </div>

        {/* Toast overlay */}
        <AlertToast />
      </div>

      {/* Recording control bar (at bottom, similar to replay timeline) */}
      <div className="bg-white border-t border-slate-200 px-4 py-2">
        {/* Status bar with indicator */}
        <div className="flex items-center gap-3">
          {/* Recording indicator / button */}
          <button
            onClick={recording.isRecording ? handleStopRecording : handleStartRecording}
            disabled={isLoading}
            className={`flex items-center gap-2 px-3 py-1.5 rounded font-medium text-sm transition-colors ${
              recording.isRecording
                ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {/* Recording dot indicator */}
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                recording.isRecording
                  ? 'bg-red-500 animate-pulse'
                  : 'bg-slate-400'
              }`}
            />
            {recording.isRecording ? 'Stop Recording' : 'Start Recording'}
          </button>

          {/* Session ID */}
          {recording.sessionId && (
            <span className="text-xs px-2 py-0.5 rounded bg-slate-100 font-mono text-slate-600">
              {recording.sessionId}
            </span>
          )}

          {/* Duration display */}
          {recording.isRecording && (
            <span className="text-xs font-mono text-slate-600 min-w-[50px]">
              {elapsed}
            </span>
          )}

          {/* Message count from heartbeat */}
          {recording.isRecording && heartbeat && (
            <span className="text-[10px] text-slate-400">
              {heartbeat.messages_relayed?.toLocaleString() ?? 0} messages
            </span>
          )}

          {/* Athletes tracked */}
          {heartbeat && (
            <span className="text-[10px] text-slate-400">
              {heartbeat.athletes_tracked ?? 0} athletes tracked
            </span>
          )}

          <div className="flex-1" />

          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                heartbeat?.zmq_position_connected
                  ? 'bg-green-500'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-[10px] text-slate-400">
              {heartbeat?.zmq_position_connected ? 'ZMQ Connected' : 'ZMQ Disconnected'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
