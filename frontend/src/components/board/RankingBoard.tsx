/**
 * Start/Ranking board — the left pane of the live view.
 *
 * Displays athletes in a sortable, filterable table with status pills,
 * pin/focus, and key gate metrics.
 *
 * Columns: Athlete/Team, Status, dist_to_line_m, eta_to_line_s,
 *          SOG (kn), COG (deg), data_age_ms.
 */

import { useMemo, useCallback } from 'react';
import { useStore, type AthleteState } from '../../stores/useStore';
import {
  formatSog,
  formatCog,
  formatDistance,
  formatEta,
  formatDataAge,
  STATUS_COLORS,
  STATUS_TEXT_COLORS,
} from '../../lib/formatters';

function getSortValue(athlete: AthleteState, key: string): number | string {
  switch (key) {
    case 'name':
      return athlete.name;
    case 'status':
      return athlete.status;
    case 'dist_to_line_m':
      return athlete.dist_to_line_m ?? 9999;
    case 'eta_to_line_s':
      return athlete.eta_to_line_s ?? 9999;
    case 'sog_kn':
      return athlete.sog_kn ?? 0;
    case 'cog_deg':
      return athlete.cog_deg ?? 0;
    case 'data_age_ms':
      return athlete.data_age_ms;
    default:
      return athlete.name;
  }
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

    // Pinned athletes first
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
      className={`px-2 py-2 text-left text-xs font-semibold text-slate-600 uppercase cursor-pointer hover:bg-slate-200 select-none ${className ?? ''}`}
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
              <th className="w-8 px-2 py-2" />
              <SortHeader col="name" label="Athlete" className="min-w-[120px]" />
              <SortHeader col="status" label="Status" />
              <SortHeader col="dist_to_line_m" label="Dist" />
              <SortHeader col="eta_to_line_s" label="ETA" />
              <SortHeader col="sog_kn" label="SOG" />
              <SortHeader col="cog_deg" label="COG" />
              <SortHeader col="data_age_ms" label="Age" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-8 text-slate-400">
                  No athletes connected
                </td>
              </tr>
            )}
            {sorted.map((athlete) => (
              <tr
                key={athlete.athlete_id}
                className={`border-b border-slate-100 hover:bg-blue-50 cursor-pointer transition-colors ${
                  athlete.selected ? 'bg-blue-100' : ''
                } ${athlete.pinned ? 'bg-yellow-50' : ''}`}
                onClick={() => selectAthlete(athlete.athlete_id)}
              >
                {/* Pin checkbox */}
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={athlete.pinned}
                    onChange={(e) => {
                      e.stopPropagation();
                      togglePin(athlete.athlete_id);
                    }}
                    className="accent-yellow-500"
                    title="Pin to top"
                  />
                </td>

                {/* Name + Team */}
                <td className="px-2 py-1.5">
                  <div className="font-medium text-slate-800">
                    {athlete.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {athlete.athlete_id} · {athlete.team}
                  </div>
                </td>

                {/* Status pill */}
                <td className="px-2 py-1.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                      STATUS_COLORS[athlete.status]
                    } ${STATUS_TEXT_COLORS[athlete.status]}`}
                  >
                    {athlete.status}
                  </span>
                </td>

                {/* Distance */}
                <td className="px-2 py-1.5 font-mono text-right">
                  {formatDistance(athlete.dist_to_line_m)}
                </td>

                {/* ETA */}
                <td className="px-2 py-1.5 font-mono text-right">
                  {formatEta(athlete.eta_to_line_s)}
                </td>

                {/* SOG */}
                <td className="px-2 py-1.5 font-mono text-right">
                  {formatSog(athlete.sog_kn)}
                </td>

                {/* COG */}
                <td className="px-2 py-1.5 font-mono text-right">
                  {formatCog(athlete.cog_deg)}
                </td>

                {/* Data age */}
                <td
                  className={`px-2 py-1.5 font-mono text-right text-xs ${
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
    </div>
  );
}
