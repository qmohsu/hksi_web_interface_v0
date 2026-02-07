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

/** Status → Tailwind color class mappings. */
export const STATUS_COLORS: Record<AthleteStatus, string> = {
  SAFE: 'bg-green-500',
  APPROACHING: 'bg-yellow-500',
  RISK: 'bg-orange-500',
  CROSSED: 'bg-red-500',
  OCS: 'bg-red-700',
  STALE: 'bg-gray-400',
};

/** Status → text color for contrast. */
export const STATUS_TEXT_COLORS: Record<AthleteStatus, string> = {
  SAFE: 'text-white',
  APPROACHING: 'text-black',
  RISK: 'text-white',
  CROSSED: 'text-white',
  OCS: 'text-white',
  STALE: 'text-white',
};
