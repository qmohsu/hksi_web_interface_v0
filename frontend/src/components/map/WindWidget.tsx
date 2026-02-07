/**
 * Wind widget — shows wind direction and speed as a compass overlay.
 *
 * Positioned in the bottom-right of the map.
 * Displays an arrow showing where the wind is COMING FROM.
 */

import { useStore } from '../../stores/useStore';
import { formatWindDir } from '../../lib/formatters';

export function WindWidget() {
  const wind = useStore((s) => s.wind);
  const setWind = useStore((s) => s.setWind);

  // Demo wind if not set — coaches can override manually
  const currentWind = wind ?? { direction_deg: 0, speed_kn: 0 };
  const hasWind = wind !== null;

  return (
    <div className="absolute bottom-4 right-4 z-[1000]">
      <div className="bg-white/95 backdrop-blur-sm shadow-lg rounded-lg border border-slate-200 p-2 w-24">
        <div className="text-[10px] font-bold text-slate-500 uppercase text-center mb-1">
          Wind
        </div>

        {/* Compass rose */}
        <div className="relative w-16 h-16 mx-auto">
          {/* Outer circle */}
          <svg viewBox="0 0 64 64" className="w-full h-full">
            <circle cx="32" cy="32" r="28" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
            {/* Cardinal directions */}
            <text x="32" y="8" textAnchor="middle" className="text-[7px] fill-slate-500 font-bold">N</text>
            <text x="56" y="35" textAnchor="middle" className="text-[7px] fill-slate-400">E</text>
            <text x="32" y="62" textAnchor="middle" className="text-[7px] fill-slate-400">S</text>
            <text x="8" y="35" textAnchor="middle" className="text-[7px] fill-slate-400">W</text>
            {/* Wind arrow — points to where wind is COMING FROM */}
            <g transform={`rotate(${currentWind.direction_deg}, 32, 32)`}>
              <line x1="32" y1="8" x2="32" y2="48" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
              <polygon points="32,8 27,18 37,18" fill="#3b82f6" />
            </g>
          </svg>
        </div>

        {/* Speed and direction text */}
        <div className="text-center mt-1">
          {hasWind ? (
            <>
              <div className="text-xs font-bold text-slate-800">
                {currentWind.speed_kn.toFixed(0)} kn
              </div>
              <div className="text-[10px] text-slate-500">
                {formatWindDir(currentWind.direction_deg)} ({currentWind.direction_deg.toFixed(0)}°)
              </div>
            </>
          ) : (
            <div className="text-[10px] text-slate-400">No data</div>
          )}
        </div>

        {/* Quick manual set (for field use) */}
        {!hasWind && (
          <button
            onClick={() => setWind({ direction_deg: 225, speed_kn: 12 })}
            className="w-full mt-1 text-[10px] text-blue-500 hover:text-blue-600"
          >
            Set demo wind
          </button>
        )}
      </div>
    </div>
  );
}
