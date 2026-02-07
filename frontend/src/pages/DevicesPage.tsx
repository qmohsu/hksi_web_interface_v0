/**
 * Devices page — operational device health monitoring.
 *
 * Shows online/offline status, packet loss, last seen time.
 * Battery, RSSI, and time sync show "N/A" until gateway provides data.
 */

import { useStore } from '../stores/useStore';
import { formatTime } from '../lib/formatters';

export function DevicesPage() {
  const deviceHealth = useStore((s) => s.deviceHealth);
  const devices = Object.values(deviceHealth);

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-800">Devices</h2>
        <p className="text-sm text-slate-500">
          Monitor anchors, tags, and gateway health
        </p>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Device
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Type
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Status
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Last Seen
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Pkt Loss
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Battery
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                RSSI
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                Time Sync
              </th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-400">
                  No device health data received yet.
                  <br />
                  <span className="text-xs">
                    Device health updates will appear when the relay is connected to HKSI_Pos.
                  </span>
                </td>
              </tr>
            )}
            {devices.map((d) => (
              <tr
                key={d.device_id}
                className="border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-4 py-2 font-medium">{d.device_id}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      d.device_type === 'ANCHOR'
                        ? 'bg-amber-100 text-amber-800'
                        : d.device_type === 'TAG'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {d.device_type}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      d.online ? 'text-green-600' : 'text-red-500'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        d.online ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    {d.online ? 'Online' : 'Offline'}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">
                  {d.last_seen_ms ? formatTime(d.last_seen_ms) : '—'}
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {d.packet_loss_pct !== null
                    ? `${d.packet_loss_pct.toFixed(1)}%`
                    : 'N/A'}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-400">
                  {d.battery_pct !== null ? `${d.battery_pct}%` : 'N/A'}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-400">
                  {d.rssi_dbm !== null ? `${d.rssi_dbm} dBm` : 'N/A'}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-400">
                  {d.time_sync_offset_ms !== null
                    ? `${d.time_sync_offset_ms.toFixed(1)} ms`
                    : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
