/**
 * WebSocket message contracts — matches WS_MESSAGE_SCHEMA.md v1.0.
 *
 * This is the SINGLE source of truth for all relay → UI message types.
 * Do NOT define message shapes elsewhere.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type MessageType =
  | 'position_update'
  | 'gate_metrics'
  | 'start_line_definition'
  | 'device_health'
  | 'event'
  | 'heartbeat';

export type AthleteStatus =
  | 'SAFE'
  | 'APPROACHING'
  | 'RISK'
  | 'CROSSED'
  | 'OCS'
  | 'STALE';

export type CrossingEvent = 'NO_CROSSING' | 'CROSSING_LEFT' | 'CROSSING_RIGHT';

export type EventKind =
  | 'CROSSING'
  | 'OCS'
  | 'RISK_ALERT'
  | 'START_SIGNAL'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_ONLINE';

export type DeviceType = 'ANCHOR' | 'TAG' | 'GATEWAY';

export type GateQuality = 'GOOD' | 'DEGRADED' | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface PositionEntry {
  athlete_id: string;
  device_id: number;
  name: string;
  team: string;
  lat: number;
  lon: number;
  alt_m: number;
  sog_kn: number | null;
  cog_deg: number | null;
  source_mask: number;
  device_ts_ms: number;
  data_age_ms: number;
}

export interface PositionUpdatePayload {
  positions: PositionEntry[];
}

export interface GateMetricEntry {
  athlete_id: string;
  device_id: number;
  name: string;
  dist_to_line_m: number;
  s_along: number;
  eta_to_line_s: number | null;
  speed_to_line_mps: number;
  gate_length_m: number;
  status: AthleteStatus;
  crossing_event: CrossingEvent;
  crossing_confidence: number;
  position_quality: number;
}

export interface GateAlert {
  athlete_id: string;
  name: string;
  event: CrossingEvent;
  crossing_ts_ms: number;
  confidence: number;
}

export interface GateMetricsPayload {
  metrics: GateMetricEntry[];
  alerts: GateAlert[];
}

export interface AnchorPoint {
  device_id: number;
  anchor_id: string;
  lat: number;
  lon: number;
}

export interface StartLineDefinitionPayload {
  anchor_left: AnchorPoint;
  anchor_right: AnchorPoint;
  gate_length_m: number;
  quality: GateQuality;
}

export interface DeviceHealthPayload {
  device_id: string;
  device_type: DeviceType;
  online: boolean;
  last_seen_ms: number;
  battery_pct: number | null;
  packet_loss_pct: number | null;
  rssi_dbm: number | null;
  time_sync_offset_ms: number | null;
}

export interface EventPayload {
  event_kind: EventKind;
  athlete_id: string | null;
  name: string | null;
  details: Record<string, unknown>;
}

export interface HeartbeatPayload {
  uptime_s: number;
  connected_clients: number;
  zmq_position_connected: boolean;
  zmq_gate_connected: boolean;
  athletes_tracked: number;
  messages_relayed: number;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface WSMessage<T = unknown> {
  type: MessageType;
  schema_version: string;
  seq: number;
  ts_ms: number;
  session_id: string | null;
  payload: T;
}

// Typed message helpers
export type PositionUpdateMessage = WSMessage<PositionUpdatePayload>;
export type GateMetricsMessage = WSMessage<GateMetricsPayload>;
export type StartLineDefinitionMessage = WSMessage<StartLineDefinitionPayload>;
export type DeviceHealthMessage = WSMessage<DeviceHealthPayload>;
export type EventMessage = WSMessage<EventPayload>;
export type HeartbeatMessage = WSMessage<HeartbeatPayload>;
