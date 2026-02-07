# WebSocket Message Schema — Relay → Coach Monitor UI

**Version:** 1.0
**Status:** FROZEN (Phase 0)
**Last updated:** 2026-02-07

This document defines the WebSocket contract between the **relay/bridge service** and the **Coach Monitor web UI**. The relay transforms data from the [HKSI_Pos](https://github.com/IPNL-POLYU/HKSI_Pos) centralized positioning server (ZMQ PUB) into these JSON messages delivered over WebSocket.

---

## 1. Connection

| Property | Value |
|----------|-------|
| Endpoint | `wss://<relay-host>/ws` or `ws://<relay-host>/ws` |
| Protocol | WebSocket (RFC 6455) |
| Encoding | UTF-8 JSON, one message per WebSocket frame |
| Heartbeat | Server sends `heartbeat` every 5 s; client should reconnect if no message received for 15 s |

---

## 2. Common Envelope

Every message uses this envelope:

```json
{
  "type": "<message_type>",
  "schema_version": "1.0",
  "seq": 12345,
  "ts_ms": 1730000000000,
  "session_id": "S2026-01-23-AM",
  "payload": { ... }
}
```

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `type` | string | — | One of: `position_update`, `gate_metrics`, `start_line_definition`, `device_health`, `event`, `heartbeat` |
| `schema_version` | string | — | Semantic version of this schema. Currently `"1.0"` |
| `seq` | int | — | Monotonically increasing sequence number (per relay instance). Clients can detect gaps |
| `ts_ms` | int | milliseconds | Server timestamp (Unix epoch ms) when the relay emitted this message |
| `session_id` | string | — | Current session identifier, or `null` if no active session |
| `payload` | object | — | Type-specific payload (see below) |

---

## 3. Message Types

### 3.1 `position_update` (batched, ~10 Hz)

Position updates for all tracked athletes, enriched by the relay with athlete names and SOG/COG.

```json
{
  "type": "position_update",
  "schema_version": "1.0",
  "seq": 1001,
  "ts_ms": 1730000000000,
  "session_id": "S2026-01-23-AM",
  "payload": {
    "positions": [
      {
        "athlete_id": "T07",
        "device_id": 8,
        "name": "LEE SONGHA",
        "team": "HKG",
        "lat": 22.12345678,
        "lon": 114.12345678,
        "alt_m": 0.5,
        "sog_kn": 9.4,
        "cog_deg": 255.0,
        "source_mask": 1,
        "device_ts_ms": 1729999999780,
        "data_age_ms": 220
      }
    ]
  }
}
```

**Payload fields — `positions[]`:**

| Field | Type | Unit | Source | Description |
|-------|------|------|--------|-------------|
| `athlete_id` | string | — | Relay (registry) | Athlete identifier (e.g., `"T07"`) |
| `device_id` | int | — | HKSI_Pos | Raw device ID (Tags: 1–99, Anchors: 101–199) |
| `name` | string | — | Relay (registry) | Athlete display name |
| `team` | string | — | Relay (registry) | Team code |
| `lat` | float | degrees WGS84 | HKSI_Pos | Latitude (8 decimal places) |
| `lon` | float | degrees WGS84 | HKSI_Pos | Longitude (8 decimal places) |
| `alt_m` | float | meters | HKSI_Pos | Altitude above WGS84 ellipsoid |
| `sog_kn` | float \| null | knots | Relay (computed) | Speed over ground. `null` if insufficient data |
| `cog_deg` | float \| null | degrees | Relay (computed) | Course over ground (0–360). `null` if insufficient data |
| `source_mask` | int | bitmask | HKSI_Pos | 1=UWB, 2=IMU, 4=GNSS |
| `device_ts_ms` | int | milliseconds | HKSI_Pos (µs→ms) | Device timestamp converted from µs |
| `data_age_ms` | int | milliseconds | Relay (computed) | `relay_ts_ms - device_ts_ms` |

---

### 3.2 `gate_metrics` (batched, ~10 Hz)

Gate (start-line) metrics for all athletes, enriched with coaching status.

```json
{
  "type": "gate_metrics",
  "schema_version": "1.0",
  "seq": 1002,
  "ts_ms": 1730000000000,
  "session_id": "S2026-01-23-AM",
  "payload": {
    "metrics": [
      {
        "athlete_id": "T07",
        "device_id": 8,
        "name": "LEE SONGHA",
        "dist_to_line_m": -5.2,
        "s_along": 0.45,
        "eta_to_line_s": 1.04,
        "speed_to_line_mps": 5.0,
        "gate_length_m": 30.0,
        "status": "APPROACHING",
        "crossing_event": "NO_CROSSING",
        "crossing_confidence": 0.0,
        "position_quality": 0.85
      }
    ],
    "alerts": [
      {
        "athlete_id": "T07",
        "name": "LEE SONGHA",
        "event": "CROSSING_LEFT",
        "crossing_ts_ms": 1730000000000,
        "confidence": 0.85
      }
    ]
  }
}
```

**Payload fields — `metrics[]`:**

| Field | Type | Unit | Source | Description |
|-------|------|------|--------|-------------|
| `athlete_id` | string | — | Relay (registry) | Athlete identifier |
| `device_id` | int | — | HKSI_Pos | Raw device ID |
| `name` | string | — | Relay (registry) | Athlete display name |
| `dist_to_line_m` | float | meters | HKSI_Pos (`d_perp_signed_m`) | Signed perpendicular distance. Positive = pre-start side |
| `s_along` | float | 0.0–1.0 | HKSI_Pos | Projected position along gate segment (0 = left anchor, 1 = right anchor) |
| `eta_to_line_s` | float \| null | seconds | HKSI_Pos (`time_to_line_s`) | Estimated time to line crossing. `null` if not moving |
| `speed_to_line_mps` | float | m/s | HKSI_Pos | Perpendicular speed toward line |
| `gate_length_m` | float | meters | HKSI_Pos | Distance between left and right anchors |
| `status` | string | — | Relay (classified) | One of: `SAFE`, `APPROACHING`, `RISK`, `CROSSED`, `OCS`, `STALE` |
| `crossing_event` | string | — | HKSI_Pos | `NO_CROSSING`, `CROSSING_LEFT`, or `CROSSING_RIGHT` |
| `crossing_confidence` | float | 0.0–1.0 | HKSI_Pos | Confidence of crossing detection |
| `position_quality` | float | 0.0–1.0 | HKSI_Pos (`tag_position_quality`) | Position solution quality |

**Payload fields — `alerts[]`:**

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `athlete_id` | string | — | Athlete identifier |
| `name` | string | — | Athlete display name |
| `event` | string | — | `CROSSING_LEFT` or `CROSSING_RIGHT` |
| `crossing_ts_ms` | int | milliseconds | Crossing timestamp |
| `confidence` | float | 0.0–1.0 | Crossing confidence |

---

### 3.3 `start_line_definition` (on session start + anchor movement)

Defines the start-line geometry from anchor positions.

```json
{
  "type": "start_line_definition",
  "schema_version": "1.0",
  "seq": 1,
  "ts_ms": 1730000000000,
  "session_id": "S2026-01-23-AM",
  "payload": {
    "anchor_left": { "device_id": 101, "anchor_id": "A0", "lat": 22.1200, "lon": 114.1200 },
    "anchor_right": { "device_id": 102, "anchor_id": "A1", "lat": 22.1210, "lon": 114.1250 },
    "gate_length_m": 30.0,
    "quality": "GOOD"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `anchor_left` | object | Left anchor: `device_id` (int), `anchor_id` (string), `lat` (float), `lon` (float) |
| `anchor_right` | object | Right anchor: same fields |
| `gate_length_m` | float | Computed distance between anchors (meters) |
| `quality` | string | `GOOD`, `DEGRADED`, or `UNKNOWN` |

---

### 3.4 `device_health` (periodic, ~1 Hz or on change)

Per-device health telemetry.

```json
{
  "type": "device_health",
  "schema_version": "1.0",
  "seq": 500,
  "ts_ms": 1730000000000,
  "session_id": "S2026-01-23-AM",
  "payload": {
    "device_id": "A0",
    "device_type": "ANCHOR",
    "online": true,
    "last_seen_ms": 1730000000000,
    "battery_pct": null,
    "packet_loss_pct": 1.2,
    "rssi_dbm": null,
    "time_sync_offset_ms": null
  }
}
```

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `device_id` | string | — | Device identifier (e.g., `"A0"`, `"T07"`) |
| `device_type` | string | — | `ANCHOR`, `TAG`, or `GATEWAY` |
| `online` | bool | — | `true` if data received within staleness threshold |
| `last_seen_ms` | int | milliseconds | Last received data timestamp |
| `battery_pct` | float \| null | percent | Battery level. `null` if unavailable |
| `packet_loss_pct` | float \| null | percent | Rolling packet loss rate. `null` if unavailable |
| `rssi_dbm` | float \| null | dBm | Signal strength. `null` if unavailable |
| `time_sync_offset_ms` | float \| null | milliseconds | Time sync offset. `null` if unavailable |

---

### 3.5 `event` (on crossing, alert, or start signal)

Discrete events for the alert system and timeline markers.

```json
{
  "type": "event",
  "schema_version": "1.0",
  "seq": 2001,
  "ts_ms": 1730000000000,
  "session_id": "S2026-01-23-AM",
  "payload": {
    "event_kind": "CROSSING",
    "athlete_id": "T07",
    "name": "LEE SONGHA",
    "details": {
      "crossing_event": "CROSSING_LEFT",
      "confidence": 0.85,
      "d_perp_signed_m": 0.1
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event_kind` | string | One of: `CROSSING`, `OCS`, `RISK_ALERT`, `START_SIGNAL`, `DEVICE_OFFLINE`, `DEVICE_ONLINE` |
| `athlete_id` | string \| null | Athlete identifier (null for system events like `START_SIGNAL`) |
| `name` | string \| null | Athlete display name |
| `details` | object | Event-specific details (varies by `event_kind`) |

**`details` by event_kind:**

- **CROSSING / OCS:** `{ "crossing_event": string, "confidence": float, "d_perp_signed_m": float }`
- **RISK_ALERT:** `{ "eta_to_line_s": float, "dist_to_line_m": float }`
- **START_SIGNAL:** `{ "signal_ts_ms": int }`
- **DEVICE_OFFLINE / DEVICE_ONLINE:** `{ "device_id": string, "device_type": string }`

---

### 3.6 `heartbeat` (every 5 seconds)

Keep-alive message with relay status summary.

```json
{
  "type": "heartbeat",
  "schema_version": "1.0",
  "seq": 9999,
  "ts_ms": 1730000000000,
  "session_id": "S2026-01-23-AM",
  "payload": {
    "uptime_s": 3600,
    "connected_clients": 1,
    "zmq_position_connected": true,
    "zmq_gate_connected": true,
    "athletes_tracked": 12,
    "messages_relayed": 50000
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `uptime_s` | int | Relay uptime in seconds |
| `connected_clients` | int | Number of WebSocket clients connected |
| `zmq_position_connected` | bool | ZMQ position subscriber connected |
| `zmq_gate_connected` | bool | ZMQ gate metrics subscriber connected |
| `athletes_tracked` | int | Number of athletes with recent data |
| `messages_relayed` | int | Total messages relayed since startup |

---

## 4. Timestamp Conventions

| Convention | Value |
|------------|-------|
| Epoch | Unix epoch (1970-01-01T00:00:00Z) |
| Unit in messages | **Milliseconds** (ms) |
| HKSI_Pos unit | Microseconds (µs) — relay converts by dividing by 1000 |
| Field suffix | `_ms` for milliseconds, `_s` for seconds, `_us` for microseconds (only in upstream) |

---

## 5. Status Enum

| Status | Condition | UI Color |
|--------|-----------|----------|
| `SAFE` | Far from line or not approaching | Green |
| `APPROACHING` | Within distance threshold and moving toward line | Yellow |
| `RISK` | ETA < Y seconds before start signal | Orange |
| `CROSSED` | Crossing event detected | Red |
| `OCS` | Crossed before start signal | Red + alert |
| `STALE` | No position update for > N seconds | Grey |

Default thresholds: distance X = 50 m, time Y = 5 s, staleness N = 3 s. Configurable via Settings.

---

## 6. Athlete Registry Config Format

```json
{
  "athletes": [
    { "device_id": 1, "athlete_id": "T00", "name": "CHAN SIU MING", "team": "HKG" },
    { "device_id": 2, "athlete_id": "T01", "name": "WONG KA HO", "team": "HKG" }
  ]
}
```

---

## 7. Session Pack Format (JSON Lines)

Each `.jsonl` file contains one JSON object per line. The first line is metadata:

```jsonl
{"_meta": true, "schema_version": "1.0", "session_id": "CLEAN_START", "created": "2026-02-07T00:00:00Z", "description": "Normal approach and compliant crossings", "duration_s": 120}
{"type": "start_line_definition", "schema_version": "1.0", "seq": 1, "ts_ms": 0, "session_id": "CLEAN_START", "payload": {...}}
{"type": "position_update", "schema_version": "1.0", "seq": 2, "ts_ms": 100, "session_id": "CLEAN_START", "payload": {...}}
...
```

- `ts_ms` in session packs is **relative** (offset from session start = 0).
- The mock server or replay engine adds the real wall-clock offset when playing back.

---

## 8. Error Handling

- If the relay cannot parse an upstream message, it logs the error and skips the message (no crash).
- If a client sends an unrecognized WebSocket frame, the relay ignores it and logs a warning.
- Clients should handle unknown `type` values gracefully (log and ignore).
- Clients should handle missing optional fields (`null`) without crashing.
