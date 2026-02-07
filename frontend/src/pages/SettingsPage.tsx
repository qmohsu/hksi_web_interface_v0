/**
 * Settings page — threshold configuration, units, and display options.
 *
 * Phase 0 skeleton with placeholder settings.
 */

export function SettingsPage() {
  return (
    <div className="p-4 max-w-2xl">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-800">Settings</h2>
        <p className="text-sm text-slate-500">
          Configure thresholds, units, and display options
        </p>
      </div>

      <div className="space-y-4">
        {/* Threshold configuration */}
        <section className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-slate-700 mb-3">
            Alert Thresholds
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm text-slate-600">
                APPROACHING distance (m)
              </label>
              <input
                type="number"
                defaultValue={50}
                disabled
                className="w-24 px-2 py-1 border rounded text-sm text-right text-slate-400"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-slate-600">
                RISK ETA threshold (s)
              </label>
              <input
                type="number"
                defaultValue={5}
                disabled
                className="w-24 px-2 py-1 border rounded text-sm text-right text-slate-400"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-slate-600">
                STALE timeout (s)
              </label>
              <input
                type="number"
                defaultValue={3}
                disabled
                className="w-24 px-2 py-1 border rounded text-sm text-right text-slate-400"
              />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Settings are read-only in Phase 0. Editable settings coming in a
            future release.
          </p>
        </section>

        {/* Units */}
        <section className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-slate-700 mb-3">Units</h3>
          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex justify-between">
              <span>Speed</span>
              <span className="text-slate-400">knots</span>
            </div>
            <div className="flex justify-between">
              <span>Distance</span>
              <span className="text-slate-400">meters</span>
            </div>
            <div className="flex justify-between">
              <span>Coordinates</span>
              <span className="text-slate-400">WGS84 lat/lon</span>
            </div>
          </div>
        </section>

        {/* Export defaults */}
        <section className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-slate-700 mb-3">
            Export Defaults
          </h3>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Default format</span>
            <select disabled className="border rounded px-2 py-1 text-slate-400">
              <option>CSV</option>
              <option>JSON</option>
            </select>
          </div>
        </section>
      </div>
    </div>
  );
}
