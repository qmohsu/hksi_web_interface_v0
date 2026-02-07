/**
 * Unit formatters for consistent display across the UI.
 *
 * Rule: Always show units (knots, meters, seconds) — see 25-typescript-frontend-style.mdc.
 */

import type { AthleteStatus } from '../contracts/messages';

/** Format speed over ground with unit. */
export function formatSog(sog: number | null): string {
  if (sog === null || sog === undefined) return '—';
  return `${sog.toFixed(1)} kn`;
}

/** Format course over ground with unit. */
export function formatCog(cog: number | null): string {
  if (cog === null || cog === undefined) return '—';
  return `${cog.toFixed(0)}°`;
}

/** Format distance to line with sign and unit. */
export function formatDistance(dist: number | null): string {
  if (dist === null || dist === undefined) return '—';
  return `${dist.toFixed(1)} m`;
}

/** Format ETA to line with unit. */
export function formatEta(eta: number | null): string {
  if (eta === null || eta === undefined) return '—';
  if (eta > 60) return '>60 s';
  return `${eta.toFixed(1)} s`;
}

/** Format data age with unit and staleness coloring hint. */
export function formatDataAge(ageMs: number): string {
  if (ageMs < 1000) return `${ageMs} ms`;
  return `${(ageMs / 1000).toFixed(1)} s`;
}

/** Format a timestamp to HH:MM:SS. */
export function formatTime(tsMs: number): string {
  const d = new Date(tsMs);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

/** Format wind direction as compass label. */
export function formatWindDir(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx];
}

/** Format bearing in degrees. */
export function formatBearing(deg: number | null): string {
  if (deg === null) return '—';
  return `${deg.toFixed(1)}°`;
}

/** Format measurement distance. */
export function formatMeasureDistance(m: number | null): string {
  if (m === null) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(1)} m`;
}

/** Status → Tailwind bg color class. */
export const STATUS_COLORS: Record<AthleteStatus, string> = {
  SAFE: 'bg-green-500',
  APPROACHING: 'bg-yellow-500',
  RISK: 'bg-orange-500',
  CROSSED: 'bg-red-500',
  OCS: 'bg-red-700',
  STALE: 'bg-gray-400',
};

/** Status → text color for contrast on the pill. */
export const STATUS_TEXT_COLORS: Record<AthleteStatus, string> = {
  SAFE: 'text-white',
  APPROACHING: 'text-black',
  RISK: 'text-white',
  CROSSED: 'text-white',
  OCS: 'text-white',
  STALE: 'text-white',
};

/** Status → small icon character for the pill. */
export const STATUS_ICONS: Record<AthleteStatus, string> = {
  SAFE: '\u2714',       // ✔
  APPROACHING: '\u25B6', // ▶
  RISK: '\u26A0',        // ⚠
  CROSSED: '\u2716',     // ✖
  OCS: '\u26D4',         // ⛔
  STALE: '\u25CF',       // ●
};

/** Compute haversine distance between two lat/lon points in meters. */
export function haversineDistance(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compute bearing from point 1 to point 2 in degrees. */
export function computeBearing(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x =
    Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
