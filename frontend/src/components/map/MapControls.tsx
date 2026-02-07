/**
 * Map control panel — layer toggles, track tail slider, declutter options.
 *
 * Floats in the top-right corner of the map.
 */

import { useState } from 'react';
import { useStore } from '../../stores/useStore';

export function MapControls() {
  const mapControls = useStore((s) => s.mapControls);
  const setMapControl = useStore((s) => s.setMapControl);
  const measurement = useStore((s) => s.measurement);
  const setMeasurement = useStore((s) => s.setMeasurement);
  const clearMeasurement = useStore((s) => s.clearMeasurement);
  const [expanded, setExpanded] = useState(true);

  const tailPresets = [
    { label: 'All', value: 0 },
    { label: '10s', value: 10 },
    { label: '30s', value: 30 },
    { label: '60s', value: 60 },
    { label: '2m', value: 120 },
  ];

  return (
    <div className="absolute top-2 right-2 z-[1000]">
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="bg-white shadow-lg rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 border border-slate-200 mb-1"
        title="Map controls"
      >
        {expanded ? '\u2715 Controls' : '\u2699 Controls'}
      </button>

      {expanded && (
        <div className="bg-white/95 backdrop-blur-sm shadow-lg rounded-lg p-3 w-48 border border-slate-200 space-y-3">
          {/* Layer toggles */}
          <section>
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Layers</div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={mapControls.showTracks}
                onChange={(e) => setMapControl('showTracks', e.target.checked)}
                className="accent-blue-500 w-3.5 h-3.5"
              />
              Track tails
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={mapControls.showLabels}
                onChange={(e) => setMapControl('showLabels', e.target.checked)}
                className="accent-blue-500 w-3.5 h-3.5"
              />
              Athlete labels
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={mapControls.followSelected}
                onChange={(e) => setMapControl('followSelected', e.target.checked)}
                className="accent-blue-500 w-3.5 h-3.5"
              />
              Follow selected
            </label>
          </section>

          {/* Track tail length */}
          <section>
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Track tail</div>
            <div className="flex flex-wrap gap-1">
              {tailPresets.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setMapControl('trackTailSeconds', p.value)}
                  className={`px-2 py-0.5 text-[10px] rounded border ${
                    mapControls.trackTailSeconds === p.value
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          {/* Measurement tool */}
          <section>
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Measure</div>
            <button
              onClick={() => {
                if (measurement.active) {
                  clearMeasurement();
                } else {
                  setMeasurement({ active: true, startLatLon: null, endLatLon: null, distance_m: null, bearing_deg: null });
                }
              }}
              className={`w-full px-2 py-1 text-xs rounded border ${
                measurement.active
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {measurement.active ? '\u2716 Cancel measure' : '\u21A6 Measure distance'}
            </button>
            {measurement.distance_m != null && (
              <div className="mt-1 text-[10px] text-slate-600 font-mono">
                {measurement.distance_m.toFixed(1)} m · {measurement.bearing_deg?.toFixed(1)}°
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
