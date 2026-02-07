/**
 * HTTP API client for the relay/mock server.
 *
 * Handles session management, replay data, and export downloads.
 * Uses the Vite dev proxy (/api → http://localhost:8000/api).
 */

const API_BASE = '/api';

export interface SessionMeta {
  session_id: string;
  start_time_utc: string | null;
  end_time_utc: string | null;
  duration_s: number | null;
  message_count: number | null;
  athlete_count: number | null;
  athlete_ids?: string[];
  has_messages?: boolean;
  legacy_pack?: boolean;
}

export interface SessionMessagesResponse {
  session_id: string;
  count: number;
  messages: Array<Record<string, unknown>>;
}

/** Fetch relay/mock server health. */
export async function fetchHealth(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

/** List all available sessions. */
export async function fetchSessions(): Promise<SessionMeta[]> {
  const res = await fetch(`${API_BASE}/sessions`);
  if (!res.ok) throw new Error(`Fetch sessions failed: ${res.status}`);
  const data = await res.json();
  return data.sessions ?? [];
}

/** Get metadata for a specific session. */
export async function fetchSession(sessionId: string): Promise<SessionMeta> {
  const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`Fetch session failed: ${res.status}`);
  return res.json();
}

/** Get all messages for a session (for client-side replay). */
export async function fetchSessionMessages(
  sessionId: string
): Promise<SessionMessagesResponse> {
  const res = await fetch(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/messages`
  );
  if (!res.ok) throw new Error(`Fetch messages failed: ${res.status}`);
  return res.json();
}

/** Start a recording session. */
export async function startSession(
  sessionId?: string
): Promise<{ status: string; session_id: string }> {
  const url = sessionId
    ? `${API_BASE}/sessions/start?session_id=${encodeURIComponent(sessionId)}`
    : `${API_BASE}/sessions/start`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Start session failed: ${res.status}`);
  return res.json();
}

/** Stop the current recording session. */
export async function stopSession(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/sessions/stop`, { method: 'POST' });
  if (!res.ok) throw new Error(`Stop session failed: ${res.status}`);
  return res.json();
}

/** Download session export as CSV. */
export function exportSessionCsvUrl(sessionId: string): string {
  return `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/export?format=csv`;
}

/** Download session export as JSON. */
export function exportSessionJsonUrl(sessionId: string): string {
  return `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/export?format=json`;
}

/** Trigger browser download of a file via URL. */
export function downloadFile(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
