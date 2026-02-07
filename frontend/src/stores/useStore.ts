/**
 * Central state store for the Coach Monitor UI.
 *
 * Single predictable state container for: athletes, tracks, start line,
 * alerts, device health, and connection status.
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

export interface TrackPoint {
  lat: number;
  lon: number;
  ts_ms: number;
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
  // Track history
  track: TrackPoint[];
  // UI state
  pinned: boolean;
  selected: boolean;
  last_update_ms: number;
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

  // Events / alerts log (bounded)
  events: Array<EventPayload & { ts_ms: number }>;

  // Device health (keyed by device_id string)
  deviceHealth: Record<string, DeviceHealthPayload>;

  // Heartbeat
  heartbeat: HeartbeatPayload | null;

  // UI controls
  sortColumn: string;
  sortAscending: boolean;
  filterText: string;

  // Actions
  setConnectionStatus: (s: ConnectionStatus) => void;
  handleMessage: (msg: WSMessage) => void;
  togglePin: (athleteId: string) => void;
  selectAthlete: (athleteId: string | null) => void;
  setSortColumn: (col: string) => void;
  setFilterText: (text: string) => void;
}

export const useStore = create<AppState>((set) => ({
  // Initial state
  connectionStatus: 'disconnected',
  lastMessageTs: 0,
  sessionId: null,
  athletes: {},
  startLine: null,
  events: [],
  deviceHealth: {},
  heartbeat: null,
  sortColumn: 'dist_to_line_m',
  sortAscending: true,
  filterText: '',

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
            // Append to ring buffer
            const newTrack = [
              ...track.slice(-(MAX_TRACK_POINTS - 1)),
              { lat: pos.lat, lon: pos.lon, ts_ms: pos.device_ts_ms },
            ];

            athletes[pos.athlete_id] = {
              ...(existing ?? {
                dist_to_line_m: null,
                eta_to_line_s: null,
                speed_to_line_mps: null,
                status: 'SAFE' as AthleteStatus,
                position_quality: null,
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
}));
