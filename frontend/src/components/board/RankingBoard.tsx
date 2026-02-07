/**
 * Start/Ranking board — the left pane of the live view.
 *
 * Phase 1: Full interactions — filter, sort, pin, status pill with icon,
 *          rank column, avg SOG, hover tooltip with detailed metrics.
 */

import { useMemo, useCallback, useState, useRef } from 'react';
import { useStore, type AthleteState } from '../../stores/useStore';
import {
  formatSog,
  formatCog,
  formatDistance,
  formatEta,
  formatDataAge,
  STATUS_COLORS,
  STATUS_TEXT_COLORS,
  STATUS_ICONS,
} from '../../lib/formatters';

function getSortValue(athlete: AthleteState, key: string): number | string {
  switch (key) {
    case 'rank':
      return Math.abs(athlete.dist_to_line_m ?? 9999);
    case 'name':
      return athlete.name;
    case 'status':
      return athlete.status;
    case 'dist_to_line_m':
      return Math.abs(athlete.dist_to_line_m ?? 9999);
    case 'eta_to_line_s':
      return athlete.eta_to_line_s ?? 9999;
    case 'sog_kn':
      return athlete.sog_kn ?? 0;
    case 'avg_sog_kn':
      return athlete.avg_sog_kn ?? 0;
    case 'cog_deg':
      return athlete.cog_deg ?? 0;
    case 'data_age_ms':
      return athlete.data_age_ms;
    default:
      return athlete.name;
  }
}

/** Floating tooltip showing detailed athlete metrics on hover. */
function AthleteTooltip({
  athlete,
  position,
}: {
  athlete: AthleteState;
  position: { top: number; left: number };
}) {
  return (
    <div
      className="fixed z-50 bg-slate-800 text-white text-xs rounded-lg shadow-xl px-3 py-2 pointer-events-none"
      style={{ top: position.top - 8, left: position.left + 16 }}
    >
      <div className="font-bold text-sm mb-1">{athlete.name}</div>
      <div className="text-slate-300 mb-1.5">{athlete.athlete_id} · {athlete.team}</div>
      <table className="w-full">
        <tbody>
          <Row label="Status" value={athlete.status} />
          <Row label="Distance" value={formatDistance(athlete.dist_to_line_m)} />
          <Row label="ETA" value={formatEta(athlete.eta_to_line_s)} />
          <Row label="SOG" value={formatSog(athlete.sog_kn)} />
          <Row label="Avg SOG (10s)" value={formatSog(athlete.avg_sog_kn)} />
          <Row label="COG" value={formatCog(athlete.cog_deg)} />
          <Row label="Spd to line" value={athlete.speed_to_line_mps != null ? `${athlete.speed_to_line_mps.toFixed(1)} m/s` : '—'} />
          <Row label="Pos quality" value={athlete.position_quality != null ? `${(athlete.position_quality * 100).toFixed(0)}%` : '—'} />
          <Row label="Data age" value={formatDataAge(athlete.data_age_ms)} />
          <Row label="Lat" value={athlete.lat.toFixed(6)} />
          <Row label="Lon" value={athlete.lon.toFixed(6)} />
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="pr-3 text-slate-400 py-0.5">{label}</td>
      <td className="text-right font-mono">{value}</td>
    </tr>
  );
}

export function RankingBoard() {
  const athletes = useStore((s) => s.athletes);
  const sortColumn = useStore((s) => s.sortColumn);
  const sortAscending = useStore((s) => s.sortAscending);
  const filterText = useStore((s) => s.filterText);
  const setSortColumn = useStore((s) => s.setSortColumn);
  const setFilterText = useStore((s) => s.setFilterText);
  const togglePin = useStore((s) => s.togglePin);
  const selectAthlete = useStore((s) => s.selectAthlete);

  // Tooltip state
  const [tooltipAthlete, setTooltipAthlete] = useState<AthleteState | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sorted = useMemo(() => {
    let list = Object.values(athletes);

    // Filter
    if (filterText) {
      const lower = filterText.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(lower) ||
          a.team.toLowerCase().includes(lower) ||
          a.athlete_id.toLowerCase().includes(lower)
      );
    }

    // Pinned athletes first, then by sort column
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const va = getSortValue(a, sortColumn);
      const vb = getSortValue(b, sortColumn);
      if (va < vb) return sortAscending ? -1 : 1;
      if (va > vb) return sortAscending ? 1 : -1;
      return 0;
    });

    return list;
  }, [athletes, sortColumn, sortAscending, filterText]);

  const handleSort = useCallback(
    (col: string) => setSortColumn(col),
    [setSortColumn]
  );

  const handleRowMouseEnter = useCallback(
    (athlete: AthleteState, e: React.MouseEvent) => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        setTooltipAthlete(athlete);
        setTooltipPos({ top: e.clientY, left: e.clientX });
      }, 400);
    },
    []
  );

  const handleRowMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setTooltipAthlete(null);
  }, []);

  const SortHeader = ({
    col,
    label,
    className,
  }: {
    col: string;
    label: string;
    className?: string;
  }) => (
    <th
      className={`px-2 py-2 text-left text-xs font-semibold text-slate-600 uppercase cursor-pointer hover:bg-slate-200 select-none whitespace-nowrap ${className ?? ''}`}
      onClick={() => handleSort(col)}
    >
      {label}
      {sortColumn === col && (
        <span className="ml-1">{sortAscending ? '\u25B2' : '\u25BC'}</span>
      )}
    </th>
  );

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow">
      {/* Filter */}
      <div className="p-2 border-b border-slate-200">
        <input
          type="text"
          placeholder="Filter by name, team, or ID..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr>
              <th className="w-8 px-1 py-2" />
              <SortHeader col="rank" label="#" className="w-8" />
              <SortHeader col="name" label="Athlete" className="min-w-[110px]" />
              <SortHeader col="status" label="Status" />
              <SortHeader col="dist_to_line_m" label="Dist" />
              <SortHeader col="eta_to_line_s" label="ETA" />
              <SortHeader col="sog_kn" label="SOG" />
              <SortHeader col="avg_sog_kn" label="Avg" />
              <SortHeader col="cog_deg" label="COG" />
              <SortHeader col="data_age_ms" label="Age" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-slate-400">
                  No athletes connected
                </td>
              </tr>
            )}
            {sorted.map((athlete, idx) => (
              <tr
                key={athlete.athlete_id}
                className={`border-b border-slate-100 cursor-pointer transition-colors ${
                  athlete.selected
                    ? 'bg-blue-100 hover:bg-blue-150'
                    : athlete.pinned
                      ? 'bg-yellow-50 hover:bg-yellow-100'
                      : 'hover:bg-blue-50'
                }`}
                onClick={() => selectAthlete(athlete.athlete_id)}
                onMouseEnter={(e) => handleRowMouseEnter(athlete, e)}
                onMouseLeave={handleRowMouseLeave}
              >
                {/* Pin checkbox */}
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={athlete.pinned}
                    onChange={(e) => {
                      e.stopPropagation();
                      togglePin(athlete.athlete_id);
                    }}
                    className="accent-yellow-500 w-3.5 h-3.5"
                    title="Pin to top"
                  />
                </td>

                {/* Rank */}
                <td className="px-1 py-1 text-center text-xs font-bold text-slate-400">
                  {idx + 1}
                </td>

                {/* Name + Team */}
                <td className="px-2 py-1">
                  <div className="font-medium text-slate-800 leading-tight">
                    {athlete.name}
                  </div>
                  <div className="text-[10px] text-slate-400 leading-tight">
                    {athlete.athlete_id} · {athlete.team}
                  </div>
                </td>

                {/* Status pill with icon */}
                <td className="px-1 py-1">
                  <span
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      STATUS_COLORS[athlete.status]
                    } ${STATUS_TEXT_COLORS[athlete.status]}`}
                  >
                    <span>{STATUS_ICONS[athlete.status]}</span>
                    <span>{athlete.status}</span>
                  </span>
                </td>

                {/* Distance */}
                <td className="px-1 py-1 font-mono text-right text-xs">
                  {formatDistance(athlete.dist_to_line_m)}
                </td>

                {/* ETA */}
                <td className="px-1 py-1 font-mono text-right text-xs">
                  {formatEta(athlete.eta_to_line_s)}
                </td>

                {/* SOG */}
                <td className="px-1 py-1 font-mono text-right text-xs">
                  {formatSog(athlete.sog_kn)}
                </td>

                {/* Avg SOG */}
                <td className="px-1 py-1 font-mono text-right text-xs text-slate-500">
                  {formatSog(athlete.avg_sog_kn)}
                </td>

                {/* COG */}
                <td className="px-1 py-1 font-mono text-right text-xs">
                  {formatCog(athlete.cog_deg)}
                </td>

                {/* Data age */}
                <td
                  className={`px-1 py-1 font-mono text-right text-[10px] ${
                    athlete.data_age_ms > 3000 ? 'text-red-500 font-bold' : 'text-slate-500'
                  }`}
                >
                  {formatDataAge(athlete.data_age_ms)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: count */}
      <div className="px-3 py-1.5 text-xs text-slate-400 border-t border-slate-200">
        {sorted.length} athlete{sorted.length !== 1 ? 's' : ''}
        {filterText && ` (filtered from ${Object.keys(athletes).length})`}
      </div>

      {/* Hover tooltip */}
      {tooltipAthlete && (
        <AthleteTooltip athlete={tooltipAthlete} position={tooltipPos} />
      )}
    </div>
  );
}
