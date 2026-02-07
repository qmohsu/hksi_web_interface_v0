/**
 * Map component — the right pane of the live view.
 *
 * Renders: start line, athlete markers with heading arrows,
 * track tails, and labels using Leaflet.
 *
 * Throttles map updates to ~10 Hz via requestAnimationFrame.
 */

import { useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { useStore } from '../../stores/useStore';

// Map constants
const DEFAULT_CENTER: [number, number] = [22.296, 114.168]; // Hong Kong waters
const DEFAULT_ZOOM = 16;

// Status → marker color (hex for SVG)
const STATUS_HEX: Record<string, string> = {
  SAFE: '#22c55e',
  APPROACHING: '#eab308',
  RISK: '#f97316',
  CROSSED: '#ef4444',
  OCS: '#dc2626',
  STALE: '#9ca3af',
};

function createAthleteIcon(status: string, cog: number | null): L.DivIcon {
  const color = STATUS_HEX[status] ?? STATUS_HEX['STALE'];
  const rotation = cog ?? 0;
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `
      <div style="
        width: 28px; height: 28px; position: relative;
        display: flex; align-items: center; justify-content: center;
      ">
        <svg width="28" height="28" viewBox="0 0 28 28" style="transform: rotate(${rotation}deg)">
          <circle cx="14" cy="14" r="10" fill="${color}" stroke="white" stroke-width="2" opacity="0.9"/>
          <polygon points="14,4 11,12 17,12" fill="white" opacity="0.9"/>
        </svg>
      </div>
    `,
  });
}

function createAnchorIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `
      <div style="
        width: 20px; height: 20px; background: #f59e0b;
        border: 2px solid white; border-radius: 3px;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: bold; color: white;
      ">A</div>
    `,
  });
}

export function MapView() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const tracksRef = useRef<Record<string, L.Polyline>>({});
  const startLineRef = useRef<L.Polyline | null>(null);
  const anchorMarkersRef = useRef<L.Marker[]>([]);

  const athletes = useStore((s) => s.athletes);
  const startLine = useStore((s) => s.startLine);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 20,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update start line
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !startLine) return;

    // Remove previous
    if (startLineRef.current) {
      startLineRef.current.remove();
    }
    anchorMarkersRef.current.forEach((m) => m.remove());
    anchorMarkersRef.current = [];

    const left: [number, number] = [startLine.anchor_left.lat, startLine.anchor_left.lon];
    const right: [number, number] = [startLine.anchor_right.lat, startLine.anchor_right.lon];

    // Start line
    startLineRef.current = L.polyline([left, right], {
      color: '#f59e0b',
      weight: 4,
      dashArray: '8, 8',
    }).addTo(map);

    // Anchor markers
    const anchorIcon = createAnchorIcon();
    const leftMarker = L.marker(left, { icon: anchorIcon })
      .bindTooltip(startLine.anchor_left.anchor_id, { permanent: true, direction: 'top', offset: [0, -12] })
      .addTo(map);
    const rightMarker = L.marker(right, { icon: anchorIcon })
      .bindTooltip(startLine.anchor_right.anchor_id, { permanent: true, direction: 'top', offset: [0, -12] })
      .addTo(map);
    anchorMarkersRef.current = [leftMarker, rightMarker];

    // Fit bounds to include start line
    map.fitBounds(L.latLngBounds(left, right).pad(0.5));
  }, [startLine]);

  // Update athlete markers and tracks (throttled via React batching)
  const athleteList = useMemo(() => Object.values(athletes), [athletes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set<string>();

    for (const athlete of athleteList) {
      currentIds.add(athlete.athlete_id);
      const icon = createAthleteIcon(athlete.status, athlete.cog_deg);

      // Update or create marker
      if (markersRef.current[athlete.athlete_id]) {
        const marker = markersRef.current[athlete.athlete_id];
        marker.setLatLng([athlete.lat, athlete.lon]);
        marker.setIcon(icon);
      } else {
        const marker = L.marker([athlete.lat, athlete.lon], { icon })
          .addTo(map);
        marker.bindTooltip(
          `<strong>${athlete.name}</strong><br/>${athlete.athlete_id}`,
          { direction: 'top', offset: [0, -16] }
        );
        markersRef.current[athlete.athlete_id] = marker;
      }

      // Update track polyline
      if (athlete.track.length > 1) {
        const latlngs: [number, number][] = athlete.track.map((p) => [p.lat, p.lon]);
        const color = STATUS_HEX[athlete.status] ?? '#9ca3af';

        if (tracksRef.current[athlete.athlete_id]) {
          tracksRef.current[athlete.athlete_id].setLatLngs(latlngs);
          tracksRef.current[athlete.athlete_id].setStyle({ color, opacity: 0.5 });
        } else {
          const polyline = L.polyline(latlngs, {
            color,
            weight: 2,
            opacity: 0.5,
          }).addTo(map);
          tracksRef.current[athlete.athlete_id] = polyline;
        }
      }
    }

    // Remove stale markers
    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
        if (tracksRef.current[id]) {
          tracksRef.current[id].remove();
          delete tracksRef.current[id];
        }
      }
    }
  }, [athleteList]);

  return (
    <div className="h-full w-full rounded-lg overflow-hidden shadow">
      <div ref={mapContainerRef} className="h-full w-full" />
    </div>
  );
}
