# UI Design Document — Start-Gate Coach Monitor Web Interface

- **Version:** v0.2
- **Owner:** (Li-Ta Hsu)
- **Audience:** Raspberry Pi engineers, Web/UI engineers, Server engineers, Coaches/Stakeholders
- **Last updated:** 2026-02-07

---

## 1. Background and Scope

This UI project implements the "Coach Monitor terminals" portion of the integrated windsurfing training analytics system. It must support:

- Real-time coaching display of athletes near the start line and key metrics.
- Automated indicators such as trajectories, segment/lap times, speed profiles.
- Session replay and data export for coaching workflows.
- Operational tooling (device status, link quality, battery reporting) to support daily use.

This UI design is also aligned with stakeholder expectations shown in the reference GUI screenshot:

- **Left:** "Ranking board" (sortable/filterable table)
- **Right:** Live map with tracks, labels, minimap, wind indicator, and layer tools

> **Upstream positioning server:** The UI consumes data from the HKSI_Pos centralized positioning server ([github.com/IPNL-POLYU/HKSI_Pos](https://github.com/IPNL-POLYU/HKSI_Pos)). HKSI_Pos publishes position batches and gate (start-line) metrics via ZMQ PUB sockets. Because browsers cannot connect to ZMQ directly, a **relay/bridge service** is required between HKSI_Pos and this web interface (see Section 8).

---

## 2. Goals

### 2.1 Product Goals

- **Coach-at-a-glance live start monitoring**
  - Distance-to-line, time-to-line, speed, heading
  - Start status and alerts (e.g., "Risk", "OCS", "Crossed", "Safe")
- **Replay and review**
  - Post-session replay with timeline controls
  - Exportable datasets for performance review
- **Operational confidence**
  - Device status/health panel (anchors, tags, gateways): battery, link quality, dropouts, time sync health

### 2.2 Engineering Goals

- Stable interface contract (data schema + APIs) to unblock Raspberry Pi and Web engineers.
- Meets measurable performance targets (latency, reliability, scalability).

---

## 3. Non-Goals (Out of Scope for This UI MVP)

- Full athlete management system (profiles, training plans)
- Video/computer vision integration
- Advanced analytics beyond start-focused KPIs unless already computed by server
- Multi-tenant cloud admin portal (keep minimal; add later if required)

---

## 4. Users and Key Workflows

### 4.1 Primary Users

| User | Focus |
|------|-------|
| **Head Coach** | Real-time start positioning, compliance risk, post-session review |
| **Assistant Coach / Analyst** | Replay, export, comparisons |
| **Operator / Technician** | Setup, device health monitoring |

### 4.2 Core Workflows

#### Pre-Session Setup

1. Select "Session"
2. Confirm start line geometry (two buoys/anchors), calibration status
3. Confirm all athletes connected and time sync healthy

#### Live Start Monitoring

1. Watch ranking board + map
2. Receive alerts (risk/OCS/cross)
3. Tap an athlete to focus (camera follow, highlight track, show detailed metrics)

#### Post-Session Replay

1. Select session → replay
2. Scrub timeline, vary playback speed
3. Export data (CSV/JSON) and generate quick "session summary"

#### Operational Troubleshooting

1. Device health view (battery, link quality, packet loss, time sync offsets)
2. Identify missing athlete tag, failing anchor, degraded link

---

## 5. Information Architecture

### 5.1 Navigation (Top-Level)

- **Live**
- **Replay**
- **Sessions**
- **Devices**
- **Settings**

### 5.2 Global Persistent UI Elements

**Header bar:**

- Session status: `LIVE` / `REPLAY` / `OFFLINE DEMO`
- Connection indicator (WS connected, data age)
- Current time + "start countdown" (optional)
- Quick export button (when replaying)

---

## 6. UI Layout and Components

### 6.1 Live Screen Layout (Matches Stakeholder GUI Pattern)

**Two-pane layout:**

#### (A) Left Pane: "Start/Ranking Board"

- **Search filter box** (by athlete/team name)
- **Sortable columns** (examples; finalize with coaches):
  - Athlete/Team
  - Rank (by time-to-line or distance-to-line; configurable)
  - Start Status (Safe / Risk / OCS / Crossed)
  - Distance-to-line (m)
  - Time-to-line (s)
  - SOG (knots)
  - COG (deg)
  - Avg SOG (knots) (rolling window, e.g., last 10s)
  - Last update age (ms/s)
- **Row affordances:**
  - Checkbox to "pin" an athlete
  - Status color pill (color + icon)
  - Hover/tap: mini tooltip (more metrics)

#### (B) Right Pane: "Map + Tracks"

- **Base map** (Leaflet or Mapbox GL; choose based on existing codebase)
- **Render:**
  - Start line (segment between two buoys/anchors)
  - Athletes as markers with direction "heading arrow"
  - Track tails (last N seconds; configurable)
  - Labels: athlete name + current SOG (like stakeholder GUI)
- **Map widgets:**
  - Minimap (overview + viewport rectangle)
  - Wind widget (direction + speed)
  - Layer toggles (tracks on/off, labels on/off, heatmap on/off)
  - Measurement tool (bearing + distance; shown in stakeholder GUI)

### 6.2 Replay Screen Layout

Same board + map layout, plus:

- **Timeline scrub bar**
- **Playback controls:** play/pause, 0.5× / 1× / 2× / 4×, jump-to-start-signal
- **Event markers on timeline:**
  - "Start signal"
  - "Line crossing (per athlete)"
  - Alerts triggered (risk/OCS)
- **Optional: Charts panel** (collapsible) for selected athlete(s):
  - Distance-to-line vs time
  - Time-to-line vs time
  - SOG vs time
  - COG vs time

### 6.3 Sessions Screen

- Session list with filters (date, location, coach, session type)
- Click session → open replay
- Bulk export / download session package

### 6.4 Devices Screen (Operational Tooling)

Must include:

- **Inventory list:** anchors/buoys, athlete tags, gateway/Raspberry Pi(s)
- **Per device:**
  - Online/offline
  - Battery (% + estimated remaining time)
  - Link quality / RSSI (if provided)
  - Packet loss (rolling)
  - Last seen time
  - Time sync health indicator

> This supports the program's emphasis on device resilience and monitoring.

### 6.5 Settings Screen

- Threshold configuration (per training mode)
- Units (knots/m/s, meters)
- Map settings (offline tiles on/off)
- Export format defaults (CSV/JSON)

---

## 7. Definitions: Key Metrics and Statuses

> **Note:** The upstream HKSI_Pos server computes distance-to-line (`d_perp_signed_m`), time-to-line (`time_to_line_s`), and raw crossing events (`CROSSING_LEFT` / `CROSSING_RIGHT`). The relay service maps these into the coaching statuses below and computes SOG/COG from velocity data.

### 7.1 Distance-to-Line (Signed) — `d_perp_signed_m`

HKSI_Pos defines the start line (gate) as the segment from `anchor_left` → `anchor_right` and computes the signed perpendicular distance from the tag position to the infinite line through those two anchors.

**Sign convention (from HKSI_Pos `GateCalculator`):** Positive = right side of line (looking from left anchor to right anchor). Negative = left side. The relay service maps this to the coaching convention:

- **Positive** = "pre-start side" (safe side)
- **Negative** = "post-start side" (crossed side)

The relay must document which physical side of the start line is "pre-start" and configure accordingly. This depends on the course layout for each session.

HKSI_Pos also computes `s_along` (0.0 = left anchor, 1.0 = right anchor), which can be used for visualization (projected position on segment).

### 7.2 Time-to-Line (ETA) — `time_to_line_s`

HKSI_Pos computes `time_to_line_s = |d_perp_signed_m| / speed_to_line_mps`, capped at 60 seconds, or `null` if the athlete is not moving. The relay passes this through directly.

### 7.3 SOG and COG — Computed by Relay

HKSI_Pos publishes tag velocity internally (`vel_enu` in the `PositionEstimate`) but does **not** include it in the published `Position` message on port 5000. Two options:

- **Preferred:** Request HKSI_Pos team to add `vel_e_mps`, `vel_n_mps` fields to the output `Position` proto (low effort — data already exists internally in the kinematic filter).
- **Fallback:** Relay computes SOG/COG from successive position updates using finite differences (noisier, adds ~100 ms latency).

**Conversions:**

- SOG (knots) = `sqrt(vel_e² + vel_n²) × 1.94384`
- COG (degrees) = `atan2(vel_e, vel_n) mod 360`

### 7.4 Start Status Categories (Canonical Enum)

The relay service classifies each athlete into one of these statuses, using gate metrics from HKSI_Pos plus optional start-signal time:

| Status | Condition | Color |
|--------|-----------|-------|
| **SAFE** | `\|d_perp_signed_m\| > X` and not approaching, or no data yet | Green |
| **APPROACHING** | `\|d_perp_signed_m\| < X` and `speed_to_line_mps > threshold` | Yellow |
| **RISK** | `time_to_line_s < Y` seconds before start signal (requires start time) | Orange |
| **CROSSED** | `crossing_event != NO_CROSSING` (from HKSI_Pos gate metrics) | Red |
| **OCS** | CROSSED **and** crossing occurred before start signal time | Red + alert |
| **STALE** | No position update received for > N seconds | Grey |

Thresholds X, Y, N are configurable in Settings (see Section 6.5). Default suggestions: X = 50 m, Y = 5 s, N = 3 s.

> **Note on HKSI_Pos crossing events:** HKSI_Pos provides `crossing_event` with values `NO_CROSSING`, `CROSSING_LEFT`, `CROSSING_RIGHT` and a `crossing_confidence` score (0–1). The relay uses these to trigger CROSSED/OCS. If start signal time is not available, RISK and OCS are unavailable; the UI still shows SAFE / APPROACHING / CROSSED / STALE.

---

## 8. Data Contract and Integration Points

### 8.1 High-Level Architecture

```
Anchors (UWB + GNSS)              Tags (UWB)
      |                               |
      v                               v
   [4G Network]                 [4G Network]
      |                               |
      +---------------+---------------+
                      v
              +-----------------+
              |  HKSI_Pos       |  Centralized positioning server
              |  (ZMQ PULL:7000)|  github.com/IPNL-POLYU/HKSI_Pos
              +--------+--------+
                       |
          +------------+------------+
          v                         v
  ZMQ PUB :5000             ZMQ PUB :5001
  (PositionBatch            (GateMetricsBatch
   @ 10 Hz)                  @ 10 Hz)
          |                         |
          +------------+------------+
                       v
              +-----------------+
              |  Relay / Bridge |  <-- NEW: This project must build
              |  Service        |
              |  (ZMQ SUB ->    |
              |   WebSocket)    |
              +--------+--------+
                       |
              WebSocket (wss://)
                       |
                       v
              +-----------------+
              |  Coach Monitor  |  This web interface
              |  UI (Browser)   |
              +-----------------+
```

The relay/bridge service is the **critical integration layer** between HKSI_Pos and the Coach Monitor UI. Browsers cannot connect to ZMQ directly. The relay subscribes to both ZMQ streams, transforms and enriches the data, and re-publishes via WebSocket.

### 8.2 Upstream: What HKSI_Pos Publishes

HKSI_Pos is a stateless real-time positioning engine. It does NOT provide session management, athlete names, SOG/COG, or coaching status classification.

#### Port 5000 — Position Batch (ZMQ PUB, topic `position`, 10 Hz)

Current serialization is a custom text format:

```
SERVER_TS:<server_timestamp_us>
COUNT:<num_positions>
POS:<device_id>:<latitude>:<longitude>:<altitude>:<source_mask>:<device_timestamp_us>
POS:<device_id>:<latitude>:<longitude>:<altitude>:<source_mask>:<device_timestamp_us>
...
```

**Fields per position line:**

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `device_id` | int | — | Tags: 1–99 (T0=1, T1=2, ...). Anchors: 101–199 (A0=101, A1=102, ...) |
| `latitude` | float | degrees WGS84 | 8 decimal places |
| `longitude` | float | degrees WGS84 | 8 decimal places |
| `altitude` | float | meters | Above WGS84 ellipsoid |
| `source_mask` | int | bitmask | 1=UWB, 2=IMU(future), 4=GNSS |
| `device_timestamp_us` | int | microseconds | Device time (Unix epoch) |

#### Port 5001 — Gate Metrics Batch (ZMQ PUB, topic `gate`, 10 Hz, JSON)

```json
{
  "server_timestamp_us": 1730000000000000,
  "metrics": [
    {
      "tag_id": "T0",
      "gate_id": "start_line",
      "anchor_left_id": "A0",
      "anchor_right_id": "A1",
      "server_timestamp_us": 1730000000000000,
      "estimate_timestamp_us": 1729999999900000,
      "d_perp_signed_m": -5.2,
      "s_along": 0.45,
      "gate_length_m": 30.0,
      "crossing_event": "NO_CROSSING",
      "crossing_time_us": null,
      "crossing_confidence": 0.0,
      "tag_position_quality": 0.85,
      "time_to_line_s": 1.04,
      "speed_to_line_mps": 5.0
    }
  ],
  "alerts": [
    {
      "tag_id": "T0",
      "gate_id": "start_line",
      "event": "CROSSING_LEFT",
      "crossing_time_us": 1730000000000000,
      "confidence": 0.85
    }
  ]
}
```

#### Port 8080 — HTTP Health Check

- `GET /health` → `{"status": "healthy"}` (200) or `{"status": "unhealthy"}` (503)
- `GET /status` → detailed component health (JSON)
- `GET /metrics` → counters, drop reasons, histograms (JSON)

#### What HKSI_Pos Does NOT Provide

The following must be handled by the relay or UI backend:

- WebSocket endpoint (uses ZMQ only)
- Athlete names or team mappings (only numeric `device_id`)
- SOG / COG (velocity exists internally but not in output)
- Session management (session_id, start/stop, storage, replay API)
- Coaching status classification (SAFE/RISK/OCS/APPROACHING)
- Per-device battery, RSSI, or detailed device health
- Schema versioning or sequence numbers in messages
- Start signal time

### 8.3 Relay/Bridge Service Responsibilities

The relay service (to be built as part of this project) must:

1. **Transport bridge:** Subscribe to ZMQ :5000 and :5001 on HKSI_Pos; re-publish to browser clients via WebSocket.
2. **Message transformation:** Parse text format (port 5000) and JSON (port 5001) into unified JSON WebSocket messages.
3. **Timestamp conversion:** Convert microseconds (µs) to milliseconds (ms) for UI consumption.
4. **Device ID → athlete mapping:** Maintain an athlete registry (`device_id` → `{athlete_id, name, team}`) loaded from config.
5. **SOG/COG computation:** Compute speed-over-ground and course-over-ground from successive positions or from velocity data (if HKSI_Pos adds velocity to output).
6. **Status classification:** Implement the SAFE/APPROACHING/RISK/CROSSED/OCS/STALE logic (Section 7.4) using gate metrics + optional start signal time.
7. **Start-line definition message:** Construct the `start_line_definition` message from anchor positions in the PositionBatch (anchors are device_id 101+).
8. **Data age computation:** Compute `data_age_ms = server_time - device_timestamp` per athlete.
9. **Session management:** Start/stop sessions, record messages, provide replay and export APIs.
10. **Device health enrichment:** Forward HKSI_Pos `/status` and `/metrics`, enrich with gateway-reported battery/RSSI if available.
11. **Schema versioning:** Add `schema_version` and `seq` to every outgoing WebSocket message.

### 8.4 WebSocket Contract (Relay → UI)

**Endpoint:** `wss://<relay-host>/ws`

All messages use a common envelope:

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

---

#### Message Type: `position_update` (Batched, 10 Hz)

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
        "lat": 22.123456,
        "lon": 114.123456,
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

- **Fields added by relay** (not from HKSI_Pos): `athlete_id`, `name`, `team`, `sog_kn`, `cog_deg`, `data_age_ms`
- **Fields passed through** from HKSI_Pos: `device_id`, `lat`, `lon`, `alt_m`, `source_mask`, `device_ts_ms` (converted from µs)

---

#### Message Type: `gate_metrics` (Batched, 10 Hz)

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

- **Fields added by relay:** `athlete_id`, `name`, `status` (classified)
- **Fields renamed** from HKSI_Pos: `d_perp_signed_m` → `dist_to_line_m`, `time_to_line_s` → `eta_to_line_s`
- Timestamps converted from µs to ms

---

#### Message Type: `start_line_definition` (On Session Start + When Anchors Move)

```json
{
  "type": "start_line_definition",
  "schema_version": "1.0",
  "seq": 1,
  "ts_ms": 1730000000000,
  "session_id": "S2026-01-23-AM",
  "payload": {
    "anchor_left": {"device_id": 101, "anchor_id": "A0", "lat": 22.1200, "lon": 114.1200},
    "anchor_right": {"device_id": 102, "anchor_id": "A1", "lat": 22.1210, "lon": 114.1250},
    "gate_length_m": 30.0,
    "quality": "GOOD"
  }
}
```

Constructed by relay from anchor positions in PositionBatch. `quality` derived from anchor GNSS fix quality and gate geometry validation.

---

#### Message Type: `device_health` (Periodic, ~1 Hz or On Change)

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

> **Note:** `battery_pct`, `rssi_dbm`, and `time_sync_offset_ms` are `null` unless the gateway/RPi layer provides them. HKSI_Pos exposes aggregate `/metrics` which the relay can poll for `packet_loss_pct`. Per-device battery and RSSI require gateway-level reporting (cross-team dependency).

---

#### Message Type: `event` (On Crossing, Alert, or Start Signal)

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

`event_kind` values: `CROSSING`, `OCS`, `RISK_ALERT`, `START_SIGNAL`, `DEVICE_OFFLINE`, `DEVICE_ONLINE`.

### 8.5 HTTP Endpoints (Provided by Relay Service)

```
GET  /api/sessions                              → List sessions
GET  /api/sessions/{id}                         → Session metadata
GET  /api/sessions/{id}/export?format=csv|json  → Export session data
GET  /api/sessions/{id}/replay?from=...&to=...  → Paged replay data
POST /api/sessions                              → Start new session
POST /api/sessions/{id}/stop                    → Stop session
GET  /api/health                                → Relay + upstream health
GET  /api/athletes                              → Athlete registry
PUT  /api/athletes                              → Update athlete registry
```

### 8.6 Performance / Scalability Targets

Use these as acceptance criteria:

- Time sync alignment within **100 ms** (system-level).
- End-to-end "tag → coach display" latency within **0.5–2.0 s** (includes HKSI_Pos processing + relay + WebSocket + UI render).
- Session uptime **≥ 95–98%**, packet loss **≤ 2–5%** (logged).
- Support at least **25 athletes** and **1 coach terminal**.
- Relay service must add **< 50 ms** latency on top of HKSI_Pos output.

---

## 9. Demo / Simulation Mode

> To persuade stakeholders and unblock integration.

### 9.1 Why We Need Demo Mode

Demo mode lets you show the UI end-to-end even before Raspberry Pi and live gateway integration is ready. It also validates replay/export flows early (which are required deliverables).

### 9.2 Demo Mode Features (Minimum)

- Load a prerecorded file ("session pack") containing:
  - Start line definition
  - Time-series position updates (25 athletes)
  - Optional device health stream
- Replay it through the exact same UI pipeline as WebSocket (same message types)
- Provide **scenario selector:**
  - "Clean start"
  - "OCS case"
  - "Packet loss / dropout case"
  - "Wind shift / chaotic clustering near line"

### 9.3 Demo Visualizations to Include (For Stakeholder Persuasion)

- **Live Map + Tracks** (primary)
- **Ranking Board** updates in real time
- **Alert Toasts** (e.g., "T07 Risk: ETA 2.1s")
- **Replay Timeline** with event markers
- **Export button** that produces a CSV/JSON immediately (even if just demo data)

---

## 10. Hardware Interface Notes (For Pi Engineers Alignment)

If Raspberry Pi engineers are ingesting raw UWB output from LD150(-I), note:

- Serial uplink uses **115200bps-8-n-1**, with `mc` messages containing range fields (mm) and an internal timestamp `RANGTIME` in ms.
- LD150(-I) spec includes data update frequency **100 Hz (MAX)** and ranging accuracy **±5 cm** (device-side).
- TTL serial wiring guidance: TX→RX, GND→GND.

> **UI implication:** We should not render at 100 Hz; UI should throttle/smooth (e.g., 5–10 Hz rendering) while keeping full-rate data stored server-side if needed.

---

## 11. Logging, Observability, and QA Requirements

- UI should display **"data age"** (seconds since last update) per athlete.
- UI should log:
  - WebSocket connect/disconnect durations
  - Message parse errors
  - Export attempts and success/fail
- Server should provide:
  - Packet loss metrics and dropout counts per device (for Devices screen)

---

## 12. Open Questions / Decisions to Lock with Engineers

### 12.1 Resolved (By HKSI_Pos Review, 2026-02-07)

- **JSON vs protobuf:** HKSI_Pos uses protobuf for input, custom text + JSON for output. The relay → UI contract will use **JSON over WebSocket**. Decision: JSON for the UI layer.
- **Coordinate system:** HKSI_Pos outputs WGS84 lat/lon (converted from internal ENU). Decision: **WGS84 lat/lon** on the wire, UI renders directly on map.
- **Timestamp units:** HKSI_Pos uses microseconds (µs). Relay converts to **milliseconds (ms)** for UI. Decision: `ts_ms` (milliseconds since Unix epoch) in all WebSocket messages.

### 12.2 Still Open

- **Start signal source:** Manual button press in UI? Official countdown integration? Derived from race committee radio? This blocks RISK and OCS status classification. *Recommend:* start with manual "Start Signal" button in the relay/UI for MVP.
- **Alert thresholds per training mode:** Default values proposed in Section 7.4 (X=50m, Y=5s, N=3s). Need coach validation. Configurable in Settings.
- **Velocity in HKSI_Pos output:** File request with HKSI_Pos team to add `vel_e_mps`, `vel_n_mps` to the Position output. If declined, relay must compute SOG/COG from successive positions (lower accuracy).
- **Per-device battery and RSSI:** HKSI_Pos does not provide these. Need gateway/RPi team to forward device telemetry. Until then, `battery_pct` and `rssi_dbm` will be `null` in the UI.
- **Gate side convention:** Which physical side of the start line is "pre-start"? Needs to be configurable per session/course layout. The relay must support a sign-flip configuration.
- **Session pack format for demo/replay:** Define the file structure (JSON Lines recommended), metadata fields, and naming convention. Needed for Epic A mock server and QA scenario packs.
- **Relay technology choice:** Python (FastAPI + pyzmq) vs Node.js (zeromq.js + ws). Python is natural given HKSI_Pos is Python; FastAPI provides both WS and HTTP. *Recommend:* **Python + FastAPI + pyzmq**.
