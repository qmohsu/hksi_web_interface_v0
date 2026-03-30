/**
 * Map component — the right pane of the live view.
 *
 * Supports two modes:
 * - Outdoor: OpenStreetMap tiles, sailing-scale zoom
 * - Indoor: Blank white background with metric grid overlay, room-scale zoom
 *
 * Features:
 * - Start line (segment between two anchors)
 * - Athlete markers with direction heading arrows, color-coded by status
 * - Permanent labels (name + SOG or local coords) on each athlete marker
 * - Track tails (configurable duration via MapControls)
 * - Selected athlete: highlighted track, camera follow
 * - Non-selected athletes: faded when one is selected (declutter)
 * - Minimap (overview + viewport rectangle) — outdoor only
 * - Measurement tool (click-to-measure bearing + distance)
 * - Indoor mode: metric grid overlay with meter labels
 */

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
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
const INDOOR_ZOOM = 21;

const STATUS_HEX: Record<string, string> = {
  SAFE: '#22c55e',
  APPROACHING: '#eab308',
  RISK: '#f97316',
  CROSSED: '#ef4444',
  OCS: '#dc2626',
  STALE: '#9ca3af',
};

// Approximate meters per degree at Hong Kong / Zhuhai latitude (~22.5 N)
const METERS_PER_DEG_LAT = 111_320.0;
const METERS_PER_DEG_LON = 111_320.0 * Math.cos((22.59 * Math.PI) / 180);

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

function createAnchorIcon(indoor: boolean): L.DivIcon {
  const sz = indoor ? 28 : 20;
  const half = sz / 2;
  return L.divIcon({
    className: '',
    iconSize: [sz, sz],
    iconAnchor: [half, half],
    html: `<div style="width:${sz}px;height:${sz}px;background:#f59e0b;border:2px solid white;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:${indoor ? 13 : 10}px;font-weight:bold;color:white">A</div>`,
  });
}

// ---------------------------------------------------------------------------
// Indoor metric grid layer
// ---------------------------------------------------------------------------

class MetricGridLayer extends L.GridLayer {
  _originLat: number;
  _originLon: number;

  constructor(originLat: number, originLon: number, options?: L.GridLayerOptions) {
    super(options);
    this._originLat = originLat;
    this._originLon = originLon;
  }

  setOrigin(lat: number, lon: number) {
    this._originLat = lat;
    this._originLon = lon;
    this.redraw();
  }

  createTile(coords: L.Coords): HTMLElement {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;

    const ctx = tile.getContext('2d');
    if (!ctx) return tile;

    const map = this._map;
    if (!map) return tile;

    // Fill white background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, size.x, size.y);

    const zoom = map.getZoom();
    // Grid spacing in meters based on zoom
    let gridM: number;
    if (zoom >= 22) gridM = 1;
    else if (zoom >= 20) gridM = 2;
    else if (zoom >= 18) gridM = 5;
    else if (zoom >= 16) gridM = 10;
    else if (zoom >= 14) gridM = 50;
    else gridM = 100;

    const gridLat = gridM / METERS_PER_DEG_LAT;
    const gridLon = gridM / METERS_PER_DEG_LON;

    // Tile corners in geographic coords
    const nwPoint = L.point(coords.x * size.x, coords.y * size.y);
    const sePoint = L.point(nwPoint.x + size.x, nwPoint.y + size.y);
    const nw = map.unproject(nwPoint, coords.z);
    const se = map.unproject(sePoint, coords.z);

    // Vertical lines (constant longitude)
    const lonStart = Math.floor((nw.lng - this._originLon) / gridLon) * gridLon + this._originLon;
    for (let lon = lonStart; lon <= se.lng; lon += gridLon) {
      const pxX = map.project(L.latLng(nw.lat, lon), coords.z).x - nwPoint.x;
      const meters = Math.round((lon - this._originLon) * METERS_PER_DEG_LON);
      const isOrigin = Math.abs(meters) < 0.5;

      ctx.beginPath();
      ctx.strokeStyle = isOrigin ? '#94a3b8' : '#e2e8f0';
      ctx.lineWidth = isOrigin ? 1.5 : 0.5;
      ctx.moveTo(pxX, 0);
      ctx.lineTo(pxX, size.y);
      ctx.stroke();

      if (zoom >= 18) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${meters}m`, pxX, 12);
      }
    }

    // Horizontal lines (constant latitude)
    const latStart = Math.ceil((se.lat - this._originLat) / gridLat) * gridLat + this._originLat;
    for (let lat = latStart; lat <= nw.lat; lat += gridLat) {
      const pxY = map.project(L.latLng(lat, nw.lng), coords.z).y - nwPoint.y;
      const meters = Math.round((lat - this._originLat) * METERS_PER_DEG_LAT);
      const isOrigin = Math.abs(meters) < 0.5;

      ctx.beginPath();
      ctx.strokeStyle = isOrigin ? '#94a3b8' : '#e2e8f0';
      ctx.lineWidth = isOrigin ? 1.5 : 0.5;
      ctx.moveTo(0, pxY);
      ctx.lineTo(size.x, pxY);
      ctx.stroke();

      if (zoom >= 18) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${meters}m`, 4, pxY - 3);
      }
    }

    return tile;
  }
}

// ---------------------------------------------------------------------------
// Helper: lat/lon to ENU meters relative to a reference
// ---------------------------------------------------------------------------
function latLonToENU(lat: number, lon: number, refLat: number, refLon: number): { e: number; n: number } {
  return {
    e: (lon - refLon) * METERS_PER_DEG_LON,
    n: (lat - refLat) * METERS_PER_DEG_LAT,
  };
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
  const extraAnchorMarkersRef = useRef<Record<string, L.Marker>>({});
  const measureLineRef = useRef<L.Polyline | null>(null);
  const measureMarkersRef = useRef<L.Marker[]>([]);
  const minimapRef = useRef<L.Control | null>(null);
  const osmTileRef = useRef<L.TileLayer | null>(null);
  const gridLayerRef = useRef<MetricGridLayer | null>(null);
  const anchorDistLabelsRef = useRef<L.Marker[]>([]);
  const originRef = useRef<{ lat: number; lon: number } | null>(null);

  const athletes = useStore((s) => s.athletes);
  const startLine = useStore((s) => s.startLine);
  const extraAnchors = useStore((s) => s.extraAnchors);
  const mapControls = useStore((s) => s.mapControls);
  const autoFitBounds = useStore((s) => s.mapControls.autoFitBounds);
  const indoorMode = useStore((s) => s.mapControls.indoorMode);
  const measurement = useStore((s) => s.measurement);
  const setMeasurement = useStore((s) => s.setMeasurement);

  const [mapReady, setMapReady] = useState(false);

  // ---------------------------------------------------------------------------
  // Compute grid origin from first anchor
  // ---------------------------------------------------------------------------
  const gridOrigin = useMemo(() => {
    let lat: number | undefined;
    let lon: number | undefined;

    if (startLine) {
      lat = startLine.anchor_left.lat;
      lon = startLine.anchor_left.lon;
    } else {
      const anchors = Object.values(extraAnchors);
      if (anchors.length > 0) {
        lat = anchors[0].lat;
        lon = anchors[0].lon;
      } else {
        const aths = Object.values(athletes);
        if (aths.length > 0) {
          lat = aths[0].lat;
          lon = aths[0].lon;
        }
      }
    }

    // Only create a new reference when coordinates actually change
    const prev = originRef.current;
    if (lat !== undefined && lon !== undefined) {
      if (!prev || prev.lat !== lat || prev.lon !== lon) {
        originRef.current = { lat, lon };
      }
    }
    return originRef.current;
  }, [startLine, extraAnchors, athletes]);

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

    // Main OSM tile layer
    const osmTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OSM',
      maxZoom: 22,
      maxNativeZoom: 19,
    }).addTo(map);
    osmTileRef.current = osmTile;

    // Scale control
    L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(map);

    // Minimap
    const minimapTiles = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 14 }
    );
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
        const rect = L.rectangle(map.getBounds(), {
          color: '#3b82f6',
          weight: 2,
          fillOpacity: 0.15,
        }).addTo(minimap);
        map.on('move', () => {
          minimap.setView(map.getCenter(), Math.max(map.getZoom() - 5, 1));
          rect.setBounds(map.getBounds());
        });
        L.DomEvent.disableClickPropagation(container);
        return container;
      },
    });
    const minimapCtrl = new MiniMapControl();
    minimapCtrl.addTo(map);
    minimapRef.current = minimapCtrl;

    mapRef.current = map;
    requestAnimationFrame(() => {
      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      markersRef.current = {};
      labelsRef.current = {};
      tracksRef.current = {};
      startLineRef.current = null;
      anchorMarkersRef.current = [];
      extraAnchorMarkersRef.current = {};
      osmTileRef.current = null;
      gridLayerRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Toggle indoor/outdoor mode (tile layers)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (indoorMode) {
      // Remove OSM tiles and minimap
      if (osmTileRef.current && map.hasLayer(osmTileRef.current)) {
        map.removeLayer(osmTileRef.current);
      }
      if (minimapRef.current) {
        try { map.removeControl(minimapRef.current); } catch { /* already removed */ }
      }
      // Add metric grid
      if (!gridLayerRef.current && gridOrigin) {
        const grid = new MetricGridLayer(gridOrigin.lat, gridOrigin.lon, { maxZoom: 24 });
        grid.addTo(map);
        gridLayerRef.current = grid;
      } else if (gridLayerRef.current && gridOrigin) {
        gridLayerRef.current.setOrigin(gridOrigin.lat, gridOrigin.lon);
        if (!map.hasLayer(gridLayerRef.current)) {
          gridLayerRef.current.addTo(map);
        }
      }
    } else {
      // Remove grid, restore OSM tiles and minimap
      if (gridLayerRef.current && map.hasLayer(gridLayerRef.current)) {
        map.removeLayer(gridLayerRef.current);
      }
      if (osmTileRef.current && !map.hasLayer(osmTileRef.current)) {
        osmTileRef.current.addTo(map);
      }
      if (minimapRef.current) {
        try { minimapRef.current.addTo(map); } catch { /* already added */ }
      }
    }
  }, [indoorMode, mapReady, gridOrigin]);

  // ---------------------------------------------------------------------------
  // Fit all devices (for indoor mode)
  // ---------------------------------------------------------------------------
  const fitToAllDevices = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const points: [number, number][] = [];
    if (startLine) {
      points.push([startLine.anchor_left.lat, startLine.anchor_left.lon]);
      points.push([startLine.anchor_right.lat, startLine.anchor_right.lon]);
    }
    for (const a of Object.values(extraAnchors)) {
      points.push([a.lat, a.lon]);
    }
    for (const a of Object.values(athletes)) {
      points.push([a.lat, a.lon]);
    }

    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 22 });
    } else if (points.length === 1) {
      map.setView(points[0], INDOOR_ZOOM);
    }
  }, [startLine, extraAnchors, athletes]);

  // Auto-fit when entering indoor mode
  useEffect(() => {
    if (indoorMode && mapReady) {
      const timer = setTimeout(fitToAllDevices, 200);
      return () => clearTimeout(timer);
    }
  }, [indoorMode, mapReady, fitToAllDevices]);

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
  }, [measurement.active, measurement.startLatLon, measurement.endLatLon, setMeasurement, mapReady]);

  // Draw measurement line
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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
            `${measurement.distance_m?.toFixed(1)} m \u00b7 ${measurement.bearing_deg?.toFixed(1)}\u00b0`,
            { permanent: true, direction: 'top', offset: [0, -8], className: 'measure-tooltip' }
          )
          .addTo(map),
      ];
    }
  }, [measurement.startLatLon, measurement.endLatLon, measurement.distance_m, measurement.bearing_deg, mapReady]);

  // ---------------------------------------------------------------------------
  // Update start line
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !startLine) return;

    startLineRef.current?.remove();
    anchorMarkersRef.current.forEach((m) => m.remove());
    anchorMarkersRef.current = [];
    anchorDistLabelsRef.current.forEach((m) => m.remove());
    anchorDistLabelsRef.current = [];

    const left: [number, number] = [startLine.anchor_left.lat, startLine.anchor_left.lon];
    const right: [number, number] = [startLine.anchor_right.lat, startLine.anchor_right.lon];

    startLineRef.current = L.polyline([left, right], {
      color: '#f59e0b',
      weight: indoorMode ? 5 : 4,
      dashArray: '8, 8',
    }).addTo(map);

    const anchorIcon = createAnchorIcon(indoorMode);

    // In indoor mode: show ENU coords in anchor tooltips
    let leftTooltip = startLine.anchor_left.anchor_id;
    let rightTooltip = startLine.anchor_right.anchor_id;
    if (indoorMode && gridOrigin) {
      const lEnu = latLonToENU(left[0], left[1], gridOrigin.lat, gridOrigin.lon);
      const rEnu = latLonToENU(right[0], right[1], gridOrigin.lat, gridOrigin.lon);
      leftTooltip = `${startLine.anchor_left.anchor_id} (${lEnu.e.toFixed(1)}, ${lEnu.n.toFixed(1)})m`;
      rightTooltip = `${startLine.anchor_right.anchor_id} (${rEnu.e.toFixed(1)}, ${rEnu.n.toFixed(1)})m`;
    }

    anchorMarkersRef.current = [
      L.marker(left, { icon: anchorIcon })
        .bindTooltip(leftTooltip, { permanent: true, direction: 'top', offset: [0, -14] })
        .addTo(map),
      L.marker(right, { icon: anchorIcon })
        .bindTooltip(rightTooltip, { permanent: true, direction: 'top', offset: [0, -14] })
        .addTo(map),
    ];

    // In indoor mode show inter-anchor distance label
    if (indoorMode) {
      const midLat = (left[0] + right[0]) / 2;
      const midLon = (left[1] + right[1]) / 2;
      const dist = haversineDistance(left[0], left[1], right[0], right[1]);
      const distLabel = L.marker([midLat, midLon], {
        icon: L.divIcon({ className: '', iconSize: [0, 0] }),
        interactive: false,
      })
        .bindTooltip(`${dist.toFixed(2)} m`, {
          permanent: true,
          direction: 'bottom',
          offset: [0, 4],
          className: 'distance-label',
        })
        .addTo(map);
      anchorDistLabelsRef.current.push(distLabel);
    }

    if (autoFitBounds && !indoorMode) {
      map.fitBounds(L.latLngBounds(left, right).pad(0.5));
    }
  }, [startLine, autoFitBounds, mapReady, indoorMode, gridOrigin]);

  // ---------------------------------------------------------------------------
  // Update extra anchor markers (standalone anchors like A2)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(Object.keys(extraAnchors));

    for (const [anchorId, anchor] of Object.entries(extraAnchors)) {
      const pos: [number, number] = [anchor.lat, anchor.lon];

      let tooltipText = anchorId;
      if (indoorMode && gridOrigin) {
        const enu = latLonToENU(anchor.lat, anchor.lon, gridOrigin.lat, gridOrigin.lon);
        tooltipText = `${anchorId} (${enu.e.toFixed(1)}, ${enu.n.toFixed(1)})m`;
      }

      if (extraAnchorMarkersRef.current[anchorId]) {
        extraAnchorMarkersRef.current[anchorId].setLatLng(pos);
        extraAnchorMarkersRef.current[anchorId].setIcon(createAnchorIcon(indoorMode));
        // Update tooltip
        const tt = extraAnchorMarkersRef.current[anchorId].getTooltip();
        if (tt) tt.setContent(tooltipText);
      } else {
        extraAnchorMarkersRef.current[anchorId] = L.marker(pos, { icon: createAnchorIcon(indoorMode) })
          .bindTooltip(tooltipText, { permanent: true, direction: 'top', offset: [0, -14] })
          .addTo(map);
      }
    }

    for (const id of Object.keys(extraAnchorMarkersRef.current)) {
      if (!currentIds.has(id)) {
        extraAnchorMarkersRef.current[id].remove();
        delete extraAnchorMarkersRef.current[id];
      }
    }
  }, [extraAnchors, mapReady, indoorMode, gridOrigin]);

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
      markersRef.current[athlete.athlete_id].setZIndexOffset(athlete.selected ? 1000 : 0);

      // --- Permanent label ---
      if (mapControls.showLabels) {
        let labelText: string;
        if (indoorMode && gridOrigin) {
          const enu = latLonToENU(athlete.lat, athlete.lon, gridOrigin.lat, gridOrigin.lon);
          labelText = `${athlete.name.split(' ').pop()} (${enu.e.toFixed(1)}, ${enu.n.toFixed(1)})`;
        } else {
          labelText = `${athlete.name.split(' ').pop()} ${formatSog(athlete.sog_kn)}`;
        }
        const labelHtml = `<span style="font-size:10px;font-weight:600;white-space:nowrap;opacity:${anySelected && !athlete.selected ? 0.3 : 1}">${labelText}</span>`;

        if (labelsRef.current[athlete.athlete_id]) {
          labelsRef.current[athlete.athlete_id].setLatLng([athlete.lat, athlete.lon]);
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
        if (labelsRef.current[athlete.athlete_id]) {
          labelsRef.current[athlete.athlete_id].remove();
          delete labelsRef.current[athlete.athlete_id];
        }
      }

      // --- Track polyline ---
      if (mapControls.showTracks && athlete.track.length > 1) {
        let trackPoints = athlete.track;
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
  }, [athleteList, anySelected, mapControls.showTracks, mapControls.showLabels, mapControls.trackTailSeconds, mapReady, indoorMode, gridOrigin]);

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
      <div ref={mapContainerRef} className="h-full w-full" style={indoorMode ? { background: '#fafafa' } : undefined} />
      <MapControls />
      {!indoorMode && <WindWidget />}
      {/* Indoor mode info badge */}
      {indoorMode && gridOrigin && (
        <div className="absolute bottom-8 left-2 z-[1000] bg-white/90 backdrop-blur-sm text-xs px-3 py-1.5 rounded-lg shadow border border-slate-200 font-mono text-slate-600">
          <div className="font-bold text-slate-800 mb-0.5">Indoor Mode</div>
          <div>Origin: {gridOrigin.lat.toFixed(6)}, {gridOrigin.lon.toFixed(6)}</div>
          <div>Grid: meters from A0</div>
        </div>
      )}
      {/* Indoor fit button */}
      {indoorMode && (
        <div className="absolute bottom-8 right-2 z-[1000]">
          <button
            onClick={fitToAllDevices}
            className="bg-white shadow-lg rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 border border-slate-200"
            title="Fit all devices in view"
          >
            Fit All
          </button>
        </div>
      )}
      {/* Measurement cursor hint */}
      {measurement.active && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-indigo-600 text-white text-xs px-3 py-1 rounded-full shadow">
          {measurement.startLatLon ? 'Click end point' : 'Click start point'}
        </div>
      )}
    </div>
  );
}
