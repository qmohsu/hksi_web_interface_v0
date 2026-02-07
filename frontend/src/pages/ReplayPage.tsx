/**
 * Replay page — post-session review with timeline controls.
 *
 * Phase 0 skeleton: shows layout structure and placeholder controls.
 * Full implementation in Phase 2.
 */

export function ReplayPage() {
  return (
    <div className="flex flex-col h-full p-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-800">Session Replay</h2>
        <p className="text-sm text-slate-500">
          Select a session to replay with timeline controls
        </p>
      </div>

      {/* Placeholder: replay content */}
      <div className="flex-1 flex items-center justify-center bg-white rounded-lg shadow">
        <div className="text-center">
          <div className="text-6xl mb-4 text-slate-300">&#9654;</div>
          <h3 className="text-lg font-semibold text-slate-500">
            Replay — Coming in Phase 2
          </h3>
          <p className="text-sm text-slate-400 mt-2 max-w-md">
            This page will use the same board + map layout as the Live view,
            plus a timeline scrub bar, playback controls, and event markers.
            The replay engine reuses the same data pipeline as live mode.
          </p>
        </div>
      </div>

      {/* Timeline placeholder */}
      <div className="mt-2 bg-white rounded-lg shadow p-3">
        <div className="flex items-center gap-4">
          <button
            disabled
            className="px-3 py-1 bg-slate-200 text-slate-400 rounded text-sm"
          >
            &#9654; Play
          </button>
          <div className="flex-1 h-2 bg-slate-200 rounded">
            <div className="h-full w-0 bg-blue-500 rounded" />
          </div>
          <span className="text-xs text-slate-400 font-mono">00:00 / 00:00</span>
          <select disabled className="text-xs border rounded px-1 py-0.5 text-slate-400">
            <option>1x</option>
          </select>
        </div>
      </div>
    </div>
  );
}
