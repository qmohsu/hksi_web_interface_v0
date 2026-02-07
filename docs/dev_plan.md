# UI Development Plan — Start-Gate Coach Monitor Web Interface

- **Version:** v0.2
- **Owner:** Li-Ta Hsu
- **Engineering teams:** Web/UI, Server, Raspberry Pi/Edge, QA
- **Last updated:** 2026-02-07

---

## 1. Development Principles

- **Freeze interfaces early** (schema/APIs/time semantics) to remove cross-team blockers.
- **Ship a demo-first vertical slice:** live board + map + replay using simulated data so you can demonstrate readiness even before hardware connections.
- **Build around measurable targets:** latency, uptime, scalability.
- **Integrate with HKSI_Pos via relay/bridge.** The centralized positioning server ([HKSI_Pos](https://github.com/IPNL-POLYU/HKSI_Pos)) publishes position and gate metrics via ZMQ. A relay service is required to bridge ZMQ → WebSocket for the browser UI. This relay also handles message transformation, athlete mapping, SOG/COG computation, status classification, and session management (see Epic G and Design Doc Section 8).

---

## 2. Workstreams (Epics) and Deliverables

### Epic A — Interface Contract + Mock Server (Unblocks Everyone)

**Deliverables:**

- `WS_MESSAGE_SCHEMA.md` (final) — documents the **relay → UI** WebSocket contract (see Design Doc Section 8.4)
- Example JSON payloads + validation (must include all 6 message types: `position_update`, `gate_metrics`, `start_line_definition`, `device_health`, `event`, and heartbeat)
- Mock WebSocket server that replays a session pack in relay-output format (NOT raw HKSI_Pos format)
- Athlete registry config format (`device_id` → name/team mapping)
- Session pack file format specification (JSON Lines recommended)

**Acceptance criteria:**

- UI can run without real hardware using mock server
- `WS_MESSAGE_SCHEMA.md` includes `schema_version`, `seq`, timestamp conventions (ms), and units for every field
- At least 2 engineers from HKSI_Pos / Pi / UI teams have reviewed and signed off on the schema

---

### Epic B — Live UI (Map + Ranking Board)

**Deliverables:**

- Live page layout (two-pane)
- Ranking board: filter/sort/pin, status pill
- Map: athlete markers + tracks + labels, minimap, wind widget, layer toggles

**Acceptance criteria:**

- Supports 25 athletes with smooth rendering (UI throttled)
- Shows "data age" and connection status

---

### Epic C — Start Metrics + Alerting

**Deliverables:**

- Distance-to-line + time-to-line columns and athlete callouts
- Status logic integration ("SAFE / APPROACHING / CROSSED / RISK / OCS / STALE") — classified by relay from HKSI_Pos gate metrics (see Design Doc Section 7.4)
- Alerts panel + toast notifications + acknowledgment

**Acceptance criteria:**

- Alerts appear within the real-time latency budget (end-to-end target)
- Status classification matches the canonical enum in Design Doc Section 7.4

---

### Epic D — Replay + Export

**Deliverables:**

- Replay page with time slider + playback speeds
- Event markers (start signal, crossing, alerts) — driven by `event` message type
- Export UI: CSV/JSON download

**Acceptance criteria:**

- Replay works on a saved session pack (same pipeline as live)
- Export generates within the operational KPI (≤ 2–5 minutes post-session target is system-level; UI must support the workflow)

---

### Epic E — Devices & Health

**Deliverables:**

- Devices page: online/offline, packet loss, last seen time
- "Degraded" and "Offline" banners
- Basic troubleshooting hints (e.g., "Anchor A2 missing")

> **Note:** Battery, RSSI, and time sync fields will show "N/A" until gateway/RPi team provides per-device telemetry.

**Acceptance criteria:**

- Device health updates live and is auditable via logs

---

### Epic F — Security & Access (If Needed for Current Phase)

**Deliverables:**

- Login / role-based controls (Coach vs Admin)
- Access logging hooks (server side)

**Acceptance criteria:**

- Meets "role-based access control with data-privacy handling" direction at system level

---

### Epic G — Relay/Bridge Service (NEW — Critical Integration Layer)

> This is the **most important new epic** identified by reviewing the HKSI_Pos codebase. Without it, the UI cannot receive any data.

**Deliverables:**

1. ZMQ subscriber connecting to HKSI_Pos ports 5000 (positions) and 5001 (gate metrics)
2. WebSocket server publishing transformed messages to browser clients
3. Message parser for HKSI_Pos text format (port 5000) and JSON (port 5001)
4. Timestamp µs → ms conversion
5. Athlete registry (`device_id` → `athlete_id` / name / team) from config file
6. SOG/COG computation from successive positions (or from velocity if HKSI_Pos adds it)
7. Status classification engine (SAFE / APPROACHING / RISK / CROSSED / OCS / STALE)
8. Start-line definition constructor from anchor positions in PositionBatch
9. Session management: start/stop, message recording, replay API, export API
10. Health endpoint proxying HKSI_Pos `/health` + `/metrics`
11. Schema versioning (envelope with `schema_version` + `seq` on every message)

**Acceptance criteria:**

- Relay adds < 50 ms latency on top of HKSI_Pos output
- Supports at least 25 athletes at 10 Hz with 1 WebSocket client
- Reconnects to HKSI_Pos ZMQ with exponential backoff if connection lost
- All 6 WebSocket message types (Section 8.4) are produced correctly
- Passes integration test: replay a `.bin` file through HKSI_Pos → relay → mock browser client, verify all fields present

**Recommended stack:** **Python + FastAPI + pyzmq** (matches HKSI_Pos language; FastAPI supports both WebSocket and HTTP)

---

## 3. Suggested Implementation Phases (Engineer-Friendly)

### Phase 0 — Interface Freeze + Relay Skeleton + "Demo Mode" Baseline (~1–2 Weeks)

**Tasks:**

1. Finalize `WS_MESSAGE_SCHEMA.md` (relay → UI contract) — Design Doc Section 8.4
2. Define session pack file format (JSON Lines) + create 1 sample pack
3. Build relay skeleton: ZMQ SUB → parse → transform → WebSocket publish (`position_update` + `gate_metrics` only)
4. Build mock WebSocket server (for UI dev without relay running)
5. Implement UI skeleton and routing

**Entry criteria:** HKSI_Pos is running and accessible on known host/ports

**Output:** Running demo with fake data OR live HKSI_Pos data through relay (map + board live)

---

### Phase 1 — Live Dashboard Feature-Complete (~2–3 Weeks)

**Tasks:**

1. Full ranking board interactions (filter, sort, pin, status pill)
2. Map layers, labeling, minimap, wind widget
3. Athlete focus/pin and track tail management
4. Relay: athlete registry, SOG/COG computation, data age

**Output:** Stakeholder-facing live UI demo (connected to HKSI_Pos via relay)

---

### Phase 2 — Alerts + Replay + Export (~2–3 Weeks)

**Tasks:**

1. Relay: status classification engine (Section 7.4), event message generation
2. Implement alert framework (toast + alerts panel)
3. Implement replay engine (same UI pipeline as live, fed by session pack)
4. Relay: session recording, replay API, export API
5. Add export UI and relay integration

**Output:** End-to-end coaching workflow demo: Live → Replay → Export

---

### Phase 3 — Device Health + Robustness Hardening (~1–2 Weeks)

**Tasks:**

1. Devices view (online/offline, packet loss, last seen)
2. Relay: health endpoint proxying, device health message generation
3. Resilience behavior (dropout display, reconnect with backoff, stale badges)
4. Performance profiling at 25 athletes, 10 Hz, 30 min session (no memory leaks)
5. Start-line definition: detect anchor position changes, re-publish

**Output:** "Ops-ready" build for on-water pilot readiness

---

## 4. Cross-Team Dependency Checklist

### From HKSI_Pos Team ([github.com/IPNL-POLYU/HKSI_Pos](https://github.com/IPNL-POLYU/HKSI_Pos))

- [ ] **Confirm ZMQ output ports and formats** are stable (5000 = positions, 5001 = gate metrics). Any planned format changes?
- [ ] **Add velocity to output Position** — `vel_e_mps`, `vel_n_mps` fields in Position message and serialization (data exists in `PositionEstimate.vel_enu`, just needs passing through to `OutputPositionBuilder`). This enables accurate SOG/COG without finite-difference noise.
- [ ] **Confirm gate configuration** — which anchor IDs define the start line (currently defaults to A0/A1)? Is this configurable at runtime?
- [ ] **Provide sample `.bin` recording** for replay testing (ideally with 3+ tags and known ground truth).
- [ ] **Confirm device_id mapping** — T0→1, T1→2, ..., A0→101, A1→102 — is this stable?

### From Raspberry Pi / Gateway Engineers

- [ ] Define gateway → HKSI_Pos transport and confirm:
  - Device IDs match HKSI_Pos expectations (T0, T1, ..., A0, A1, ...)
  - Packet loss / link quality metrics — can these be forwarded to relay?
  - Battery reporting — can this be forwarded to relay?
- [ ] If using LD150(-I):
  - Confirm parsing `mc` ranges + timestamp usage (`RANGTIME` ms)
  - Confirm rate limits / downsampling strategy (100 Hz max at device)

### From Web Interface Engineers

- [ ] UI implementation in chosen stack (React/Vue + TypeScript recommended)
- [ ] Map rendering library decision (Leaflet vs Mapbox GL)
- [ ] Component library adoption and accessibility

---

## 5. Testing Strategy (Realism and Readiness)

### 5.1 Simulation-Based Tests (UI/Integration)

Use scenario packs to validate:

- 25 athletes approaching line simultaneously (stress rendering + sorting)
- Dropouts (simulate packet loss 2–5% and brief disconnects)
- Latency injection to verify UI still communicates "data age" correctly
- Start events: normal, late start, OCS

### 5.2 Relay Integration Tests

Replay a `.bin` file through HKSI_Pos → relay → test WebSocket client:

- [ ] Verify all message types are produced (`position_update`, `gate_metrics`, `start_line_definition`, `device_health`, `event`)
- [ ] Verify field names and types match `WS_MESSAGE_SCHEMA.md`
- [ ] Verify timestamps are in milliseconds
- [ ] Verify athlete names appear (from registry config)
- [ ] Verify crossing events produce `event` messages

### 5.3 Automated Tests

- **Unit tests:** Metric computations, status classification, SOG/COG conversion, timestamp conversion
- **UI tests:** Filtering/sorting/pinning, replay controls
- **Load tests:** WS message burst handling, frame-rate monitoring
- **Relay tests:** ZMQ reconnect behavior, message parsing edge cases (malformed input)

### 5.4 Scenario Packs (Required, Per QA Rule 85)

| Pack Name | Description |
|-----------|-------------|
| `CLEAN_START` | Normal approach and compliant crossings |
| `CLUSTER_NEAR_LINE` | Many athletes congested near the start line |
| `PACKET_LOSS_JITTER` | 2–5% drops + delay/jitter + out-of-order bursts |
| `DEVICE_DROPOUT` | One buoy anchor offline for 30–60s |
| `OCS_CASE` | Early crossing before start signal |

Each pack: deterministic, stored with metadata (`schema_version`, coordinate frame, units), runnable via mock WebSocket server.

### 5.5 Field-Ready Validation Checklist

- [ ] UI maintains stable behavior with intermittent connectivity (reconnect + state recovery)
- [ ] UI remains usable in bright outdoor conditions (contrast, large fonts, touch targets)
- [ ] Export and replay demonstrably work (required deliverables)

---

## 6. Definition of Done (DoD)

A feature is "Done" when:

1. Implemented + code reviewed
2. Has automated test coverage where applicable
3. Meets acceptance criteria (including performance targets where relevant)
4. Has basic docs (how to use, how to troubleshoot)
5. Works in Demo Mode and Live Mode (when connected to HKSI_Pos via relay)

---

## 7. Deliverables to Share with Stakeholders

> To prove "almost done"

- **Live demo link** (demo mode or connected to HKSI_Pos)
- **1–2 minute screen recording:**
  - Live dashboard updates (positions + gate metrics flowing)
  - Alerts firing (crossing detection from HKSI_Pos)
  - Replay scrubbing
  - Export download
- **"Interface contract" markdown** (`WS_MESSAGE_SCHEMA.md` with relay → UI contract + examples)
- **Known integration dependencies list** (what you're waiting for from HKSI_Pos / Pi / gateway teams)

---

## 8. References (Project Docs)

- SRFS application form: *(link TBD)*
- SRFS project presentation: *(link TBD)*
- LD150(-I) manual: *(link TBD)*
- HKSI_Pos centralized positioning server:
  - <https://github.com/IPNL-POLYU/HKSI_Pos> — upstream data source, ZMQ publisher, gate metrics engine
