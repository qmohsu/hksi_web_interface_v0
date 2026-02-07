UI Development Plan — Start-Gate Coach Monitor Web Interface

Version: v0.2
Owner: (Li-Ta Hsu)
Engineering teams: Web/UI, Server, Raspberry Pi/Edge, QA
Last updated: 2026-02-07

1. Development principles

Freeze interfaces early (schema/APIs/time semantics) to remove cross-team blockers.

Ship a demo-first vertical slice: live board + map + replay using simulated data so you can demonstrate readiness even before hardware connections.

Build around measurable targets: latency, uptime, scalability.

**Integrate with HKSI_Pos via relay/bridge.** The centralized positioning server ([HKSI_Pos](https://github.com/IPNL-POLYU/HKSI_Pos)) publishes position and gate metrics via ZMQ. A relay service is required to bridge ZMQ → WebSocket for the browser UI. This relay also handles message transformation, athlete mapping, SOG/COG computation, status classification, and session management (see Epic G and Design Doc Section 8).

2. Workstreams (epics) and deliverables

Epic A — Interface contract + mock server (unblocks everyone)

Deliverables

WS_MESSAGE_SCHEMA.md (final) — documents the **relay → UI** WebSocket contract (see Design Doc Section 8.4)

Example JSON payloads + validation (must include all 6 message types: `position_update`, `gate_metrics`, `start_line_definition`, `device_health`, `event`, and heartbeat)

Mock WebSocket server that replays a session pack in relay-output format (NOT raw HKSI_Pos format)

Athlete registry config format (device_id → name/team mapping)

Session pack file format specification (JSON Lines recommended)

Acceptance criteria

UI can run without real hardware using mock server

WS_MESSAGE_SCHEMA.md includes `schema_version`, `seq`, timestamp conventions (ms), and units for every field

At least 2 engineers from HKSI_Pos / Pi / UI teams have reviewed and signed off on the schema

Epic B — Live UI (map + ranking board)

Deliverables

Live page layout (two-pane)

Ranking board: filter/sort/pin, status pill

Map: athlete markers + tracks + labels, minimap, wind widget, layer toggles

Acceptance criteria

Supports 25 athletes with smooth rendering (UI throttled)

Shows "data age" and connection status

Epic C — Start metrics + alerting

Deliverables

Distance-to-line + time-to-line columns and athlete callouts

Status logic integration ("SAFE / APPROACHING / CROSSED / RISK / OCS / STALE") — classified by relay from HKSI_Pos gate metrics (see Design Doc Section 7.4)

Alerts panel + toast notifications + acknowledgment

Acceptance criteria

Alerts appear within the real-time latency budget (end-to-end target).

Status classification matches the canonical enum in Design Doc Section 7.4

Epic D — Replay + export

Deliverables

Replay page with time slider + playback speeds

Event markers (start signal, crossing, alerts) — driven by `event` message type

Export UI: CSV/JSON download

Acceptance criteria

Replay works on a saved session pack (same pipeline as live)

Export generates within the operational KPI (≤2–5 minutes post-session target is system-level; UI must support the workflow).

Epic E — Devices & health

Deliverables

Devices page: online/offline, packet loss, last seen time

"Degraded" and "Offline" banners

Basic troubleshooting hints (e.g., "Anchor A2 missing")

Note: battery, RSSI, and time sync fields will show "N/A" until gateway/RPi team provides per-device telemetry

Acceptance criteria

Device health updates live and is auditable via logs.

Epic F — Security & access (if needed for current phase)

Deliverables

Login / role-based controls (Coach vs Admin)

Access logging hooks (server side)

Acceptance criteria

Meets "role-based access control with data-privacy handling" direction at system level.

Epic G — Relay/Bridge service (NEW — critical integration layer)

This is the **most important new epic** identified by reviewing the HKSI_Pos codebase. Without it, the UI cannot receive any data.

Deliverables

ZMQ subscriber connecting to HKSI_Pos ports 5000 (positions) and 5001 (gate metrics)

WebSocket server publishing transformed messages to browser clients

Message parser for HKSI_Pos text format (port 5000) and JSON (port 5001)

Timestamp µs → ms conversion

Athlete registry (device_id → athlete_id / name / team) from config file

SOG/COG computation from successive positions (or from velocity if HKSI_Pos adds it)

Status classification engine (SAFE / APPROACHING / RISK / CROSSED / OCS / STALE)

Start-line definition constructor from anchor positions in PositionBatch

Session management: start/stop, message recording, replay API, export API

Health endpoint proxying HKSI_Pos `/health` + `/metrics`

Schema versioning (envelope with `schema_version` + `seq` on every message)

Acceptance criteria

Relay adds < 50 ms latency on top of HKSI_Pos output

Supports at least 25 athletes at 10 Hz with 1 WebSocket client

Reconnects to HKSI_Pos ZMQ with exponential backoff if connection lost

All 6 WebSocket message types (Section 8.4) are produced correctly

Passes integration test: replay a `.bin` file through HKSI_Pos → relay → mock browser client, verify all fields present

Recommended stack: **Python + FastAPI + pyzmq** (matches HKSI_Pos language; FastAPI supports both WebSocket and HTTP)

3. Suggested implementation phases (engineer-friendly)

Phase 0 — Interface freeze + relay skeleton + "demo mode" baseline (~1–2 weeks)

Tasks

Finalize WS_MESSAGE_SCHEMA.md (relay → UI contract) — Design Doc Section 8.4

Define session pack file format (JSON Lines) + create 1 sample pack

Build relay skeleton: ZMQ SUB → parse → transform → WebSocket publish (position_update + gate_metrics only)

Build mock WebSocket server (for UI dev without relay running)

Implement UI skeleton and routing

Entry criteria: HKSI_Pos is running and accessible on known host/ports

Output

Running demo with fake data OR live HKSI_Pos data through relay (map + board live)

Phase 1 — Live dashboard feature-complete (~2–3 weeks)

Tasks

Full ranking board interactions (filter, sort, pin, status pill)

Map layers, labeling, minimap, wind widget

Athlete focus/pin and track tail management

Relay: athlete registry, SOG/COG computation, data age

Output

Stakeholder-facing live UI demo (connected to HKSI_Pos via relay)

Phase 2 — Alerts + replay + export (~2–3 weeks)

Tasks

Relay: status classification engine (Section 7.4), event message generation

Implement alert framework (toast + alerts panel)

Implement replay engine (same UI pipeline as live, fed by session pack)

Relay: session recording, replay API, export API

Add export UI and relay integration

Output

End-to-end coaching workflow demo: Live → Replay → Export

Phase 3 — Device health + robustness hardening (~1–2 weeks)

Tasks

Devices view (online/offline, packet loss, last seen)

Relay: health endpoint proxying, device health message generation

Resilience behavior (dropout display, reconnect with backoff, stale badges)

Performance profiling at 25 athletes, 10 Hz, 30 min session (no memory leaks)

Start-line definition: detect anchor position changes, re-publish

Output

"Ops-ready" build for on-water pilot readiness

4. Cross-team dependency checklist (what you need from others)

From HKSI_Pos team (github.com/IPNL-POLYU/HKSI_Pos)

- **Confirm ZMQ output ports and formats** are stable (5000 = positions, 5001 = gate metrics). Any planned format changes?
- **Add velocity to output Position** — `vel_e_mps`, `vel_n_mps` fields in Position message and serialization (data exists in `PositionEstimate.vel_enu`, just needs passing through to `OutputPositionBuilder`). This enables accurate SOG/COG without finite-difference noise.
- **Confirm gate configuration** — which anchor IDs define the start line (currently defaults to A0/A1)? Is this configurable at runtime?
- **Provide sample `.bin` recording** for replay testing (ideally with 3+ tags and known ground truth).
- **Confirm device_id mapping** — T0→1, T1→2, ..., A0→101, A1→102 — is this stable?

From Raspberry Pi / gateway engineers

Define gateway → HKSI_Pos transport and confirm:

device IDs match HKSI_Pos expectations (T0, T1, ..., A0, A1, ...)

packet loss / link quality metrics — can these be forwarded to relay?

battery reporting — can this be forwarded to relay?

If using LD150(-I):

confirm parsing mc ranges + timestamp usage (RANGTIME ms)

confirm rate limits / downsampling strategy (100Hz max at device)

From web interface engineers

UI implementation in chosen stack (React/Vue + TypeScript recommended)

Map rendering library decision (Leaflet vs Mapbox GL)

Component library adoption and accessibility

5. Testing strategy (realism and readiness)
5.1 Simulation-based tests (UI/Integration)

Use scenario packs to validate:

25 athletes approaching line simultaneously (stress rendering + sorting)

Dropouts (simulate packet loss 2–5% and brief disconnects)

Latency injection to verify UI still communicates "data age" correctly

Start events: normal, late start, OCS

5.2 Relay integration tests

Replay a `.bin` file through HKSI_Pos → relay → test WebSocket client:

Verify all message types are produced (position_update, gate_metrics, start_line_definition, device_health, event)

Verify field names and types match WS_MESSAGE_SCHEMA.md

Verify timestamps are in milliseconds

Verify athlete names appear (from registry config)

Verify crossing events produce `event` messages

5.3 Automated tests

Unit tests: metric computations, status classification, SOG/COG conversion, timestamp conversion

UI tests: filtering/sorting/pinning, replay controls

Load tests: WS message burst handling, frame-rate monitoring

Relay tests: ZMQ reconnect behavior, message parsing edge cases (malformed input)

5.4 Scenario packs (required, per QA rule 85)

| Pack Name | Description |
|-----------|-------------|
| CLEAN_START | Normal approach and compliant crossings |
| CLUSTER_NEAR_LINE | Many athletes congested near the start line |
| PACKET_LOSS_JITTER | 2–5% drops + delay/jitter + out-of-order bursts |
| DEVICE_DROPOUT | One buoy anchor offline for 30–60s |
| OCS_CASE | Early crossing before start signal |

Each pack: deterministic, stored with metadata (schema_version, coordinate frame, units), runnable via mock WebSocket server.

5.5 Field-ready validation checklist

UI maintains stable behavior with intermittent connectivity (reconnect + state recovery)

UI remains usable in bright outdoor conditions (contrast, large fonts, touch targets)

Export and replay demonstrably work (required deliverables)

6. Definition of Done (DoD)

A feature is "Done" when:

Implemented + code reviewed

Has automated test coverage where applicable

Meets acceptance criteria (including performance targets where relevant)

Has basic docs (how to use, how to troubleshoot)

Works in Demo Mode and Live Mode (when connected to HKSI_Pos via relay)

7. Deliverables to share with stakeholders (to prove "almost done")

Live demo link (demo mode or connected to HKSI_Pos)

1–2 minute screen recording:

Live dashboard updates (positions + gate metrics flowing)

Alerts firing (crossing detection from HKSI_Pos)

Replay scrubbing

Export download

"Interface contract" markdown (WS_MESSAGE_SCHEMA.md with relay → UI contract + examples)

Known integration dependencies list (what you're waiting for from HKSI_Pos / Pi / gateway teams)

8. References (project docs)

SRFS application form:

SRFS project presentation:

LD150(-I) manual:

HKSI_Pos centralized positioning server:

https://github.com/IPNL-POLYU/HKSI_Pos — upstream data source, ZMQ publisher, gate metrics engine
