/**
 * Central state store for the Coach Monitor UI.
 *
 * Single predictable state container for: athletes, tracks, start line,
 * alerts, device health, connection status, and map display controls.
 * (rule 25-typescript-frontend-style: single reducer/store)
 *
 * Time-series data uses bounded ring buffers.
 */

import { create } from 'zustand';
import type {
  PositionEntry,
  GateMetricEntry,
  GateAlert,
  StartLineDefinitionPayload,
  AnchorPositionPayload,
  AnchorPoint,
  DeviceHealthPayload,
  EventPayload,
  HeartbeatPayload,
  AthleteStatus,
  WSMessage,
} from '../contracts/messages';
import type { ConnectionStatus } from '../data/streamClient';

// ---------------------------------------------------------------------------
// Track point ring buffer (bounded memory)
// ---------------------------------------------------------------------------

const MAX_TRACK_POINTS = 200; // Per athlete
const AVG_SOG_WINDOW_MS = 10_000; // Rolling 10s window for avg SOG
const STALE_ATHLETE_MS = 30_000; // Remove athletes with no update for 30s

export interface TrackPoint {
  lat: number;
  lon: number;
  ts_ms: number;
  sog_kn: number | null;
}

// ---------------------------------------------------------------------------
// Athlete state (merged position + gate metrics)
// ---------------------------------------------------------------------------

export interface AthleteState {
  athlete_id: string;
  device_id: number;
  name: string;
  team: string;
  // Position
  lat: number;
  lon: number;
  alt_m: number;
  sog_kn: number | null;
  cog_deg: number | null;
  source_mask: number;
  device_ts_ms: number;
  data_age_ms: number;
  // Gate metrics
  dist_to_line_m: number | null;
  eta_to_line_s: number | null;
  speed_to_line_mps: number | null;
  status: AthleteStatus;
  position_quality: number | null;
  // Computed
  avg_sog_kn: number | null;
  // Track history
  track: TrackPoint[];
  // UI state
  pinned: boolean;
  selected: boolean;
  last_update_ms: number;
}

// ---------------------------------------------------------------------------
// Map display controls
// ---------------------------------------------------------------------------

export interface MapControls {
  showTracks: boolean;
  showLabels: boolean;
  showAnchorLabels: boolean; // anchor names + indoor coordinate labels
  followSelected: boolean;
  trackTailSeconds: number; // 0 = all, otherwise last N seconds
  autoFitBounds: boolean;   // auto adjust map view when start line changes
  indoorMode: boolean;       // indoor positioning mode (blank map + grid)
}

// ---------------------------------------------------------------------------
// Wind data (placeholder until relay provides it)
// ---------------------------------------------------------------------------

export interface WindData {
  direction_deg: number; // Where wind is COMING FROM (0=N, 90=E)
  speed_kn: number;
}

// ---------------------------------------------------------------------------
// Measurement state
// ---------------------------------------------------------------------------

export interface MeasurementState {
  active: boolean;
  startLatLon: [number, number] | null;
  endLatLon: [number, number] | null;
  distance_m: number | null;
  bearing_deg: number | null;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface AppState {
  // Connection
  connectionStatus: ConnectionStatus;
  lastMessageTs: number;
  sessionId: string | null;

  // Athletes (keyed by athlete_id)
  athletes: Record<string, AthleteState>;

  // Start line
  startLine: StartLineDefinitionPayload | null;

  // Standalone anchors (not part of start line), keyed by anchor_id
  extraAnchors: Record<string, AnchorPoint>;

  // Events / alerts log (bounded)
  events: Array<EventPayload & { ts_ms: number }>;

  // Device health (keyed by device_id string)
  deviceHealth: Record<string, DeviceHealthPayload>;

  // Heartbeat
  heartbeat: HeartbeatPayload | null;

  // UI controls — board
  sortColumn: string;
  sortAscending: boolean;
  filterText: string;

  // UI controls — map
  mapControls: MapControls;

  // Wind (mock/manual for now)
  wind: WindData | null;

  // Measurement tool
  measurement: MeasurementState;

  // Live mode — when false, live stream messages are ignored (for replay)
  liveMode: boolean;

  // Actions
  setConnectionStatus: (s: ConnectionStatus) => void;
  handleMessage: (msg: WSMessage) => void;
  togglePin: (athleteId: string) => void;
  selectAthlete: (athleteId: string | null) => void;
  setSortColumn: (col: string) => void;
  setFilterText: (text: string) => void;
  setMapControl: <K extends keyof MapControls>(key: K, value: MapControls[K]) => void;
  setWind: (wind: WindData | null) => void;
  setMeasurement: (m: Partial<MeasurementState>) => void;
  clearMeasurement: () => void;
  setLiveMode: (enabled: boolean) => void;
  purgeStaleAthletes: () => void;
  resetState: () => void;
}

/** Compute rolling average SOG from track points within the window. */
function computeAvgSog(track: TrackPoint[], now: number): number | null {
  const cutoff = now - AVG_SOG_WINDOW_MS;
  const recent = track.filter((p) => p.ts_ms >= cutoff && p.sog_kn !== null);
  if (recent.length === 0) return null;
  const sum = recent.reduce((acc, p) => acc + (p.sog_kn ?? 0), 0);
  return Math.round((sum / recent.length) * 10) / 10;
}

// Default initial state (for reset)
const initialState = {
  connectionStatus: 'disconnected' as ConnectionStatus,
  lastMessageTs: 0,
  sessionId: null,
  athletes: {} as Record<string, AthleteState>,
  startLine: null as StartLineDefinitionPayload | null,
  extraAnchors: {} as Record<string, AnchorPoint>,
  events: [] as Array<EventPayload & { ts_ms: number }>,
  deviceHealth: {} as Record<string, DeviceHealthPayload>,
  heartbeat: null as HeartbeatPayload | null,
  sortColumn: 'dist_to_line_m',
  sortAscending: true,
  filterText: '',
  mapControls: {
    showTracks: true,
    showLabels: true,
    showAnchorLabels: true,
    followSelected: false,
    trackTailSeconds: 0,
    autoFitBounds: true,
    indoorMode: false,
  } as MapControls,
  wind: null as WindData | null,
  measurement: {
    active: false,
    startLatLon: null,
    endLatLon: null,
    distance_m: null,
    bearing_deg: null,
  } as MeasurementState,
  liveMode: true,
};

export const useStore = create<AppState>((set) => ({
  // Initial state
  ...initialState,

  // Actions
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  handleMessage: (msg) => {
    const now = Date.now();

    switch (msg.type) {
      case 'position_update': {
        const { positions } = msg.payload as { positions: PositionEntry[] };
        set((state) => {
          const athletes = { ...state.athletes };
          for (const pos of positions) {
            const existing = athletes[pos.athlete_id];
            const track = existing?.track ?? [];
            // Append to ring buffer — include sog for avg computation
            const newTrack = [
              ...track.slice(-(MAX_TRACK_POINTS - 1)),
              { lat: pos.lat, lon: pos.lon, ts_ms: pos.device_ts_ms, sog_kn: pos.sog_kn },
            ];

            athletes[pos.athlete_id] = {
              ...(existing ?? {
                dist_to_line_m: null,
                eta_to_line_s: null,
                speed_to_line_mps: null,
                status: 'SAFE' as AthleteStatus,
                position_quality: null,
                avg_sog_kn: null,
                pinned: false,
                selected: false,
              }),
              athlete_id: pos.athlete_id,
              device_id: pos.device_id,
              name: pos.name,
              team: pos.team,
              lat: pos.lat,
              lon: pos.lon,
              alt_m: pos.alt_m,
              sog_kn: pos.sog_kn,
              cog_deg: pos.cog_deg,
              source_mask: pos.source_mask,
              device_ts_ms: pos.device_ts_ms,
              data_age_ms: pos.data_age_ms,
              track: newTrack,
              avg_sog_kn: computeAvgSog(newTrack, now),
              last_update_ms: now,
            };
          }
          return { athletes, lastMessageTs: now, sessionId: msg.session_id };
        });
        break;
      }

      case 'gate_metrics': {
        const { metrics } = msg.payload as {
          metrics: GateMetricEntry[];
          alerts: GateAlert[];
        };
        set((state) => {
          const athletes = { ...state.athletes };
          for (const m of metrics) {
            const existing = athletes[m.athlete_id];
            if (existing) {
              athletes[m.athlete_id] = {
                ...existing,
                dist_to_line_m: m.dist_to_line_m,
                eta_to_line_s: m.eta_to_line_s,
                speed_to_line_mps: m.speed_to_line_mps,
                status: m.status,
                position_quality: m.position_quality,
              };
            }
          }
          return { athletes, lastMessageTs: now };
        });
        break;
      }

      case 'start_line_definition': {
        const payload = msg.payload as StartLineDefinitionPayload;
        set({ startLine: payload, lastMessageTs: now });
        break;
      }

      case 'device_health': {
        const payload = msg.payload as DeviceHealthPayload;
        set((state) => ({
          deviceHealth: {
            ...state.deviceHealth,
            [payload.device_id]: payload,
          },
          lastMessageTs: now,
        }));
        break;
      }

      case 'event': {
        const payload = msg.payload as EventPayload;
        set((state) => ({
          events: [
            ...state.events.slice(-99), // Keep last 100 events
            { ...payload, ts_ms: msg.ts_ms },
          ],
          lastMessageTs: now,
        }));
        break;
      }

      case 'heartbeat': {
        const payload = msg.payload as HeartbeatPayload;
        set({ heartbeat: payload, lastMessageTs: now, sessionId: msg.session_id });
        break;
      }

      case 'anchor_position': {
        const payload = msg.payload as AnchorPositionPayload;
        set((state) => ({
          extraAnchors: {
            ...state.extraAnchors,
            [payload.anchor.anchor_id]: payload.anchor,
          },
          lastMessageTs: now,
        }));
        break;
      }

      default:
        console.warn('[Store] Unknown message type:', msg.type);
    }
  },

  togglePin: (athleteId) =>
    set((state) => {
      const athlete = state.athletes[athleteId];
      if (!athlete) return state;
      return {
        athletes: {
          ...state.athletes,
          [athleteId]: { ...athlete, pinned: !athlete.pinned },
        },
      };
    }),

  selectAthlete: (athleteId) =>
    set((state) => {
      const athletes = { ...state.athletes };
      for (const id of Object.keys(athletes)) {
        athletes[id] = { ...athletes[id], selected: id === athleteId };
      }
      return { athletes };
    }),

  setSortColumn: (col) =>
    set((state) => ({
      sortColumn: col,
      sortAscending: state.sortColumn === col ? !state.sortAscending : true,
    })),

  setFilterText: (text) => set({ filterText: text }),

  setMapControl: (key, value) =>
    set((state) => ({
      mapControls: { ...state.mapControls, [key]: value },
    })),

  setWind: (wind) => set({ wind }),

  setMeasurement: (m) =>
    set((state) => ({
      measurement: { ...state.measurement, ...m },
    })),

  clearMeasurement: () =>
    set({
      measurement: {
        active: false,
        startLatLon: null,
        endLatLon: null,
        distance_m: null,
        bearing_deg: null,
      },
    }),

  setLiveMode: (enabled: boolean) => set({ liveMode: enabled }),

  purgeStaleAthletes: () =>
    set((state) => {
      const now = Date.now();
      const athletes = { ...state.athletes };
      let changed = false;
      for (const id of Object.keys(athletes)) {
        if (now - athletes[id].last_update_ms > STALE_ATHLETE_MS) {
          delete athletes[id];
          changed = true;
        }
      }
      return changed ? { athletes } : state;
    }),

  resetState: () =>
    set((state) => ({
      ...initialState,
      // Preserve connection status as it reflects WebSocket state
      connectionStatus: state.connectionStatus,
      // Preserve liveMode (don't reset when clearing replay/live data)
      liveMode: state.liveMode,
      // Preserve map controls (labels visibility, etc.)
      mapControls: state.mapControls,
    })),
}));
