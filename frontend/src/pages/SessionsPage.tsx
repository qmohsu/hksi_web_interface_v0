/**
 * Sessions page — list and manage recorded sessions.
 *
 * Features:
 * - List all sessions from the relay API
 * - Start/stop recording
 * - Open session in replay view
 * - Export CSV or JSON
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchSessions,
  startSession,
  stopSession,
  exportSessionCsvUrl,
  exportSessionJsonUrl,
  downloadFile,
  type SessionMeta,
} from '../data/apiClient';

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadSessions = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchSessions();
      setSessions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    // Refresh every 10 seconds
    const timer = setInterval(loadSessions, 10_000);
    return () => clearInterval(timer);
  }, [loadSessions]);

  const handleStartRecording = async () => {
    try {
      const result = await startSession();
      setRecording(true);
      setRecordingId(result.session_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start recording');
    }
  };

  const handleStopRecording = async () => {
    try {
      await stopSession();
      setRecording(false);
      setRecordingId(null);
      await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop recording');
    }
  };

  const handleReplay = (sessionId: string) => {
    navigate(`/replay?session=${encodeURIComponent(sessionId)}`);
  };

  const handleExportCsv = (sessionId: string) => {
    downloadFile(exportSessionCsvUrl(sessionId), `${sessionId}.csv`);
  };

  const handleExportJson = (sessionId: string) => {
    downloadFile(exportSessionJsonUrl(sessionId), `${sessionId}.json`);
  };

  const formatDuration = (s: number | null) => {
    if (s === null) return '—';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}m ${sec}s`;
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Sessions</h2>
          <p className="text-sm text-slate-500">
            Browse recorded sessions, open replay, or export data
          </p>
        </div>
        <div className="flex items-center gap-2">
          {recording ? (
            <button
              onClick={handleStopRecording}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 shadow"
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
              Stop Recording ({recordingId})
            </button>
          ) : (
            <button
              onClick={handleStartRecording}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
              Start Recording
            </button>
          )}
          <button
            onClick={loadSessions}
            className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Sessions table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Session ID
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Date
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Duration
              </th>
              <th className="px-4 py-3 text-center font-semibold text-slate-600">
                Messages
              </th>
              <th className="px-4 py-3 text-center font-semibold text-slate-600">
                Athletes
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-400">
                  Loading sessions...
                </td>
              </tr>
            )}
            {!loading && sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-400">
                  No sessions found.
                  <br />
                  <span className="text-xs">
                    Start a recording from the button above, or use the mock server
                    with a session pack.
                  </span>
                </td>
              </tr>
            )}
            {sessions.map((session) => (
              <tr
                key={session.session_id}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800 font-mono text-xs">
                    {session.session_id}
                  </div>
                  {session.legacy_pack && (
                    <span className="text-[10px] text-slate-400">(legacy pack)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatDate(session.start_time_utc)}
                </td>
                <td className="px-4 py-3 text-slate-600 font-mono">
                  {formatDuration(session.duration_s)}
                </td>
                <td className="px-4 py-3 text-center text-slate-600 font-mono">
                  {session.message_count ?? '—'}
                </td>
                <td className="px-4 py-3 text-center text-slate-600">
                  {session.athlete_count ?? '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleReplay(session.session_id)}
                      className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
                      title="Open in replay view"
                    >
                      Replay
                    </button>
                    <button
                      onClick={() => handleExportCsv(session.session_id)}
                      className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-700 hover:bg-slate-100 rounded"
                      title="Export as CSV"
                    >
                      CSV
                    </button>
                    <button
                      onClick={() => handleExportJson(session.session_id)}
                      className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-700 hover:bg-slate-100 rounded"
                      title="Export as JSON"
                    >
                      JSON
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
