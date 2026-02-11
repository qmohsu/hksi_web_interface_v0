/**
 * Map component — the right pane of the live view.
 *
 * Phase 1 features:
 * - Start line (segment between two anchors)
 * - Athlete markers with direction heading arrows, color-coded by status
 * - Permanent labels (name + SOG) on each athlete marker
 * - Track tails (configurable duration via MapControls)
 * - Selected athlete: highlighted track, camera follow
 * - Non-selected athletes: faded when one is selected (declutter)
 * - Minimap (overview + viewport rectangle)
 * - Measurement tool (click-to-measure bearing + distance)
 */

import { useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { useStore } from '../../stores/useStore';
import { MapControls } from './MapControls';
import { WindWidget } from './WindWidget';
import { formatSog, haversineDistance, computeBearing } from '../../lib/formatters';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CENTER: [number, number] = [22.296, 114.168];
const DEFAULT_ZOOM = 16;

const STATUS_HEX: Record<string, string> = {
  SAFE: '#22c55e',
  APPROACHING: '#eab308',
  RISK: '#f97316',
  CROSSED: '#ef4444',
  OCS: '#dc2626',
  STALE: '#9ca3af',
};

// ---------------------------------------------------------------------------
// Icon factories
// ---------------------------------------------------------------------------

function createAthleteIcon(
  status: string,
  cog: number | null,
  isSelected: boolean,
  anySelected: boolean,
): L.DivIcon {
  const color = STATUS_HEX[status] ?? STATUS_HEX['STALE'];
  const rotation = cog ?? 0;
  const size = isSelected ? 34 : 28;
  const half = size / 2;
  const opacity = anySelected && !isSelected ? 0.4 : 0.9;
  const stroke = isSelected ? 'stroke: #3b82f6; stroke-width: 3;' : 'stroke: white; stroke-width: 2;';

  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [half, half],
    html: `<div style="width:${size}px;height:${size}px;opacity:${opacity}">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(${rotation}deg)">
        <circle cx="${half}" cy="${half}" r="${half - 4}" fill="${color}" style="${stroke}"/>
        <polygon points="${half},${4} ${half - 3},${half - 2} ${half + 3},${half - 2}" fill="white" opacity="0.9"/>
      </svg>
    </div>`,
  });
}

function createAnchorIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="width:20px;height:20px;background:#f59e0b;border:2px solid white;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:white">A</div>`,
  });
}

// ---------------------------------------------------------------------------
// MapView component
// ---------------------------------------------------------------------------

export function MapView() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const labelsRef = useRef<Record<string, L.Marker>>({});
  const tracksRef = useRef<Record<string, L.Polyline>>({});
  const startLineRef = useRef<L.Polyline | null>(null);
  const anchorMarkersRef = useRef<L.Marker[]>([]);
  const measureLineRef = useRef<L.Polyline | null>(null);
  const measureMarkersRef = useRef<L.Marker[]>([]);
  const minimapRef = useRef<L.Control | null>(null);

  const athletes = useStore((s) => s.athletes);
  const startLine = useStore((s) => s.startLine);
  const mapControls = useStore((s) => s.mapControls);
  const autoFitBounds = useStore((s) => s.mapControls.autoFitBounds);
  const measurement = useStore((s) => s.measurement);
  const setMeasurement = useStore((s) => s.setMeasurement);

  // ---------------------------------------------------------------------------
  // Initialize map
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });

    // Main tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OSM',
      maxZoom: 20,
    }).addTo(map);

    // Minimap: small overview in bottom-left
    const minimapTiles = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 14 }
    );
    // We implement a simple minimap as a custom control
    const MiniMapControl = L.Control.extend({
      options: { position: 'bottomleft' as L.ControlPosition },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-minimap-container');
        container.style.cssText = 'width:140px;height:100px;border:2px solid #cbd5e1;border-radius:6px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.15);';
        const minimap = L.map(container, {
          center: map.getCenter(),
          zoom: Math.max(map.getZoom() - 5, 1),
          zoomControl: false,
          attributionControl: false,
          dragging: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          touchZoom: false,
        });
        minimapTiles.addTo(minimap);
        // Viewport rectangle
        const rect = L.rectangle(map.getBounds(), {
          color: '#3b82f6',
          weight: 2,
          fillOpacity: 0.15,
        }).addTo(minimap);
        // Sync
        map.on('move', () => {
          minimap.setView(map.getCenter(), Math.max(map.getZoom() - 5, 1));
          rect.setBounds(map.getBounds());
        });
        // Prevent click-through
        L.DomEvent.disableClickPropagation(container);
        return container;
      },
    });
    const minimapCtrl = new MiniMapControl();
    minimapCtrl.addTo(map);
    minimapRef.current = minimapCtrl;

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Measurement tool click handler
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (!measurement.active) return;

      if (!measurement.startLatLon) {
        setMeasurement({ startLatLon: [e.latlng.lat, e.latlng.lng] });
      } else if (!measurement.endLatLon) {
        const start = measurement.startLatLon;
        const end: [number, number] = [e.latlng.lat, e.latlng.lng];
        const dist = haversineDistance(start[0], start[1], end[0], end[1]);
        const brg = computeBearing(start[0], start[1], end[0], end[1]);
        setMeasurement({
          endLatLon: end,
          distance_m: dist,
          bearing_deg: brg,
          active: false,
        });
      }
    };

    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [measurement.active, measurement.startLatLon, measurement.endLatLon, setMeasurement]);

  // Draw measurement line
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous
    measureLineRef.current?.remove();
    measureLineRef.current = null;
    measureMarkersRef.current.forEach((m) => m.remove());
    measureMarkersRef.current = [];

    if (measurement.startLatLon && measurement.endLatLon) {
      const start: [number, number] = measurement.startLatLon;
      const end: [number, number] = measurement.endLatLon;

      measureLineRef.current = L.polyline([start, end], {
        color: '#6366f1',
        weight: 2,
        dashArray: '6, 4',
      }).addTo(map);

      const dotIcon = L.divIcon({
        className: '',
        iconSize: [8, 8],
        iconAnchor: [4, 4],
        html: '<div style="width:8px;height:8px;background:#6366f1;border:1px solid white;border-radius:50%"></div>',
      });
      measureMarkersRef.current = [
        L.marker(start, { icon: dotIcon }).addTo(map),
        L.marker(end, { icon: dotIcon })
          .bindTooltip(
            `${measurement.distance_m?.toFixed(1)} m · ${measurement.bearing_deg?.toFixed(1)}°`,
            { permanent: true, direction: 'top', offset: [0, -8], className: 'measure-tooltip' }
          )
          .addTo(map),
      ];
    }
  }, [measurement.startLatLon, measurement.endLatLon, measurement.distance_m, measurement.bearing_deg]);

  // ---------------------------------------------------------------------------
  // Update start line
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !startLine) return;

    startLineRef.current?.remove();
    anchorMarkersRef.current.forEach((m) => m.remove());
    anchorMarkersRef.current = [];

    const left: [number, number] = [startLine.anchor_left.lat, startLine.anchor_left.lon];
    const right: [number, number] = [startLine.anchor_right.lat, startLine.anchor_right.lon];

    startLineRef.current = L.polyline([left, right], {
      color: '#f59e0b',
      weight: 4,
      dashArray: '8, 8',
    }).addTo(map);

    const anchorIcon = createAnchorIcon();
    anchorMarkersRef.current = [
      L.marker(left, { icon: anchorIcon })
        .bindTooltip(startLine.anchor_left.anchor_id, { permanent: true, direction: 'top', offset: [0, -12] })
        .addTo(map),
      L.marker(right, { icon: anchorIcon })
        .bindTooltip(startLine.anchor_right.anchor_id, { permanent: true, direction: 'top', offset: [0, -12] })
        .addTo(map),
    ];

    if (autoFitBounds) {
      map.fitBounds(L.latLngBounds(left, right).pad(0.5));
    }
  }, [startLine, autoFitBounds]);

  // ---------------------------------------------------------------------------
  // Update athlete markers, labels, and tracks
  // ---------------------------------------------------------------------------
  const athleteList = useMemo(() => Object.values(athletes), [athletes]);
  const anySelected = useMemo(() => athleteList.some((a) => a.selected), [athleteList]);
  const selectedAthlete = useMemo(() => athleteList.find((a) => a.selected) ?? null, [athleteList]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const now = Date.now();
    const currentIds = new Set<string>();

    for (const athlete of athleteList) {
      currentIds.add(athlete.athlete_id);
      const icon = createAthleteIcon(athlete.status, athlete.cog_deg, athlete.selected, anySelected);

      // --- Marker ---
      if (markersRef.current[athlete.athlete_id]) {
        markersRef.current[athlete.athlete_id].setLatLng([athlete.lat, athlete.lon]);
        markersRef.current[athlete.athlete_id].setIcon(icon);
      } else {
        const marker = L.marker([athlete.lat, athlete.lon], { icon, zIndexOffset: athlete.selected ? 1000 : 0 })
          .addTo(map);
        markersRef.current[athlete.athlete_id] = marker;
      }
      // Update zIndex for selected
      markersRef.current[athlete.athlete_id].setZIndexOffset(athlete.selected ? 1000 : 0);

      // --- Permanent label (name + SOG) ---
      if (mapControls.showLabels) {
        const labelHtml = `<span style="font-size:10px;font-weight:600;white-space:nowrap;opacity:${anySelected && !athlete.selected ? 0.3 : 1}">${athlete.name.split(' ').pop()} ${formatSog(athlete.sog_kn)}</span>`;
        if (labelsRef.current[athlete.athlete_id]) {
          labelsRef.current[athlete.athlete_id].setLatLng([athlete.lat, athlete.lon]);
          // Update tooltip content
          const tt = labelsRef.current[athlete.athlete_id].getTooltip();
          if (tt) tt.setContent(labelHtml);
        } else {
          const labelMarker = L.marker([athlete.lat, athlete.lon], {
            icon: L.divIcon({ className: '', iconSize: [0, 0] }),
            interactive: false,
          })
            .bindTooltip(labelHtml, {
              permanent: true,
              direction: 'right',
              offset: [16, 0],
              className: 'athlete-label',
            })
            .addTo(map);
          labelsRef.current[athlete.athlete_id] = labelMarker;
        }
      } else {
        // Remove labels if hidden
        if (labelsRef.current[athlete.athlete_id]) {
          labelsRef.current[athlete.athlete_id].remove();
          delete labelsRef.current[athlete.athlete_id];
        }
      }

      // --- Track polyline ---
      if (mapControls.showTracks && athlete.track.length > 1) {
        let trackPoints = athlete.track;
        // Filter by tail duration
        if (mapControls.trackTailSeconds > 0) {
          const cutoff = now - mapControls.trackTailSeconds * 1000;
          trackPoints = trackPoints.filter((p) => p.ts_ms >= cutoff);
        }

        if (trackPoints.length > 1) {
          const latlngs: [number, number][] = trackPoints.map((p) => [p.lat, p.lon]);
          const color = STATUS_HEX[athlete.status] ?? '#9ca3af';
          const trackOpacity = anySelected && !athlete.selected ? 0.15 : 0.5;
          const trackWeight = athlete.selected ? 3.5 : 2;

          if (tracksRef.current[athlete.athlete_id]) {
            tracksRef.current[athlete.athlete_id].setLatLngs(latlngs);
            tracksRef.current[athlete.athlete_id].setStyle({
              color,
              opacity: trackOpacity,
              weight: trackWeight,
            });
          } else {
            tracksRef.current[athlete.athlete_id] = L.polyline(latlngs, {
              color,
              weight: trackWeight,
              opacity: trackOpacity,
            }).addTo(map);
          }
        }
      } else {
        // Remove track if hidden
        if (tracksRef.current[athlete.athlete_id]) {
          tracksRef.current[athlete.athlete_id].remove();
          delete tracksRef.current[athlete.athlete_id];
        }
      }
    }

    // Remove stale markers, labels, and tracks
    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
        if (labelsRef.current[id]) {
          labelsRef.current[id].remove();
          delete labelsRef.current[id];
        }
        if (tracksRef.current[id]) {
          tracksRef.current[id].remove();
          delete tracksRef.current[id];
        }
      }
    }
  }, [athleteList, anySelected, mapControls.showTracks, mapControls.showLabels, mapControls.trackTailSeconds]);

  // ---------------------------------------------------------------------------
  // Camera follow selected athlete
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapControls.followSelected || !selectedAthlete) return;
    map.panTo([selectedAthlete.lat, selectedAthlete.lon], { animate: true, duration: 0.3 });
  }, [selectedAthlete?.lat, selectedAthlete?.lon, mapControls.followSelected, selectedAthlete]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="h-full w-full rounded-lg overflow-hidden shadow relative">
      <div ref={mapContainerRef} className="h-full w-full" />
      <MapControls />
      <WindWidget />
      {/* Measurement cursor hint */}
      {measurement.active && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-indigo-600 text-white text-xs px-3 py-1 rounded-full shadow">
          {measurement.startLatLon ? 'Click end point' : 'Click start point'}
        </div>
      )}
    </div>
  );
}
