/**
 * Sessions page — list and manage recorded sessions.
 *
 * Phase 0 skeleton with placeholder content.
 * Full implementation in Phase 2.
 */

export function SessionsPage() {
  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-800">Sessions</h2>
        <p className="text-sm text-slate-500">
          Browse recorded sessions, open replay, or export data
        </p>
      </div>

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
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Athletes
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="text-center py-12 text-slate-400">
                No sessions recorded yet — coming in Phase 2.
                <br />
                <span className="text-xs">
                  Sessions will appear here once the relay service starts recording.
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
