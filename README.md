# HKSI Coach Monitor — Start-Gate Web Interface

Real-time coaching dashboard for windsurfing start-gate training at the Hong Kong Sports Institute.

Displays live athlete positions, gate metrics, and start-line status from the [HKSI_Pos](https://github.com/IPNL-POLYU/HKSI_Pos) positioning server, with session recording, replay, and data export.

---

## Architecture

```
HKSI_Pos (ZMQ PUB :5000/:5001)
            │
    ┌───────┴───────┐
    │  Relay Service │   Python / FastAPI / pyzmq
    │  (port 8000)   │   ZMQ SUB → transform → WebSocket
    └───────┬───────┘
            │ WebSocket + REST API
    ┌───────┴───────┐
    │  Frontend UI   │   React / TypeScript / Vite
    │  (port 3000)   │   Leaflet map + ranking board
    └───────────────┘
```

| Component | Stack | Port |
|-----------|-------|------|
| **Relay Service** | Python 3.10+, FastAPI, Uvicorn, pyzmq | `8000` |
| **Mock Server** | Same as Relay (synthetic or session-pack data) | `8000` |
| **Frontend Dev Server** | Node.js 20+, Vite, React 19, TypeScript | `3000` |
| **HKSI_Pos** (upstream) | C++ / ZMQ PUB | `5000`, `5001` |

---

## Prerequisites

- **Python 3.10+** with `pip`
- **Node.js 20+** with `npm` (use [nvm](https://github.com/nvm-sh/nvm) if needed)

---

## Quick Start

### 1. Install dependencies

```bash
# Python (relay service)
pip install -r relay/requirements.txt

# Node.js (frontend)
cd frontend && npm install && cd ..
```

### 2. Start the Mock Server (no HKSI_Pos needed)

The mock server generates synthetic data for 25 athletes, serving the same WebSocket and REST API as the real relay:

```bash
python3 -m relay.mock_server
```

This starts at `http://localhost:8000`. Options:

```bash
# Replay a recorded session pack instead of synthetic data
python3 -m relay.mock_server --pack relay/data/session_packs/CLEAN_START.jsonl

# Custom host/port
python3 -m relay.mock_server --host 0.0.0.0 --port 8000
```

### 3. Start the Frontend Dev Server

```bash
cd frontend
npm run dev
```

Open **http://localhost:3000** in a browser. The Vite dev server proxies `/ws` and `/api` to `localhost:8000`.

### 4. Start the Real Relay Service (requires HKSI_Pos)

When HKSI_Pos is running and publishing on ZMQ ports 5000/5001:

```bash
python3 -m relay.main
```

Configure via environment variables (prefix `RELAY_`):

```bash
# Example: point to a remote HKSI_Pos server
RELAY_ZMQ_POSITION_ENDPOINT=tcp://192.168.1.100:5000 \
RELAY_ZMQ_GATE_ENDPOINT=tcp://192.168.1.100:5001 \
python3 -m relay.main
```

### 5. Build for Production

```bash
cd frontend
npm run build
```

The built files go to `frontend/dist/`. The mock server and relay both auto-serve this directory if it exists, making the full app available at `http://localhost:8000`.

---

## Services and API Reference

### WebSocket Endpoint

| Endpoint | Description |
|----------|-------------|
| `ws://localhost:8000/ws` | Real-time data stream (relay or mock) |

Broadcasts 6 message types: `position_update`, `gate_metrics`, `start_line_definition`, `device_health`, `event`, `heartbeat`. See `docs/WS_MESSAGE_SCHEMA.md` for the full contract.

### REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server health and status |
| `GET` | `/api/athletes` | Athlete registry (device_id to name/team) |
| `GET` | `/api/sessions` | List all recorded sessions |
| `GET` | `/api/sessions/{id}` | Get session metadata |
| `GET` | `/api/sessions/{id}/messages` | Get all messages for replay |
| `GET` | `/api/sessions/{id}/export?format=csv` | Export session as CSV |
| `GET` | `/api/sessions/{id}/export?format=json` | Export session as JSON |
| `POST` | `/api/sessions/start` | Start recording a session |
| `POST` | `/api/sessions/stop` | Stop recording |

### Frontend Pages

| Route | Description |
|-------|-------------|
| `/` | **Live** — Real-time ranking board + map |
| `/replay` | **Replay** — Session playback with timeline controls |
| `/sessions` | **Sessions** — List, record, export sessions |
| `/devices` | **Devices** — Device health monitoring |
| `/settings` | **Settings** — Threshold configuration |

---

## Project Structure

```
hksi_web_interface_v0/
├── relay/                      # Python relay / mock server
│   ├── main.py                 # FastAPI relay (ZMQ → WebSocket)
│   ├── mock_server.py          # Mock server (synthetic / session pack)
│   ├── config.py               # Settings (env vars, thresholds)
│   ├── models.py               # Pydantic message models
│   ├── athlete_registry.py     # Device → athlete mapping
│   ├── message_parser.py       # HKSI_Pos message parsing
│   ├── sog_cog.py              # Speed/course computation
│   ├── status_classifier.py    # Coaching status classification
│   ├── session_recorder.py     # Session recording + export
│   ├── ws_manager.py           # WebSocket connection manager
│   ├── zmq_subscriber.py       # ZMQ subscriber with reconnect
│   ├── requirements.txt        # Python dependencies
│   └── data/
│       ├── athletes.json       # Athlete registry
│       └── session_packs/      # Recorded sessions (.jsonl)
├── frontend/                   # React / TypeScript UI
│   ├── src/
│   │   ├── App.tsx             # Root component + routing
│   │   ├── contracts/          # WS message type definitions
│   │   ├── data/               # StreamClient, ReplayEngine, API client
│   │   ├── stores/             # Zustand global state
│   │   ├── components/         # Board, Map, Alerts, Layout
│   │   ├── pages/              # Live, Replay, Sessions, Devices, Settings
│   │   ├── hooks/              # useStream
│   │   └── lib/                # Formatters, haversine, bearing
│   ├── vite.config.ts          # Vite config (proxy, TailwindCSS)
│   └── package.json
├── docs/
│   ├── design_doc.md           # UI design document
│   ├── dev_plan.md             # Development plan and phases
│   └── WS_MESSAGE_SCHEMA.md    # WebSocket message contract
└── README.md                   # This file
```

---

## Configuration

All relay settings are configurable via environment variables with the `RELAY_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_ZMQ_POSITION_ENDPOINT` | `tcp://localhost:5000` | HKSI_Pos position stream |
| `RELAY_ZMQ_GATE_ENDPOINT` | `tcp://localhost:5001` | HKSI_Pos gate metrics stream |
| `RELAY_HOST` | `0.0.0.0` | Relay bind address |
| `RELAY_PORT` | `8000` | Relay HTTP/WS port |
| `RELAY_THRESHOLD_DISTANCE_M` | `50.0` | APPROACHING status threshold (meters) |
| `RELAY_THRESHOLD_TIME_S` | `5.0` | RISK status threshold (seconds) |
| `RELAY_THRESHOLD_STALE_S` | `3.0` | STALE timeout (seconds) |
| `RELAY_HEARTBEAT_INTERVAL_S` | `5.0` | Heartbeat broadcast interval |
| `RELAY_GATE_SIGN_FLIP` | `false` | Negate d_perp sign convention |

---

## Common Workflows

### Record a live session

```bash
# Start recording (returns session_id)
curl -X POST http://localhost:8000/api/sessions/start

# ... let it run ...

# Stop recording
curl -X POST http://localhost:8000/api/sessions/stop
```

### Export a session

```bash
# CSV export
curl -o session.csv "http://localhost:8000/api/sessions/CLEAN_START/export?format=csv"

# JSON export
curl -o session.json "http://localhost:8000/api/sessions/CLEAN_START/export?format=json"
```

### Replay a session pack with the mock server

```bash
python3 -m relay.mock_server --pack relay/data/session_packs/CLEAN_START.jsonl
```

---

## Athlete Status Classification

The relay classifies each athlete into one of these coaching statuses:

| Status | Condition | Color |
|--------|-----------|-------|
| **SAFE** | Far from line or no data | Green |
| **APPROACHING** | Within threshold distance, moving toward line | Yellow |
| **RISK** | ETA < threshold before start signal | Orange |
| **CROSSED** | Crossing event detected | Red |
| **OCS** | Crossed before start signal | Dark Red |
| **STALE** | No position update for > N seconds | Grey |

---

## Documentation

- [`docs/design_doc.md`](docs/design_doc.md) — Full UI design document
- [`docs/dev_plan.md`](docs/dev_plan.md) — Development plan, epics, and phases
- [`docs/WS_MESSAGE_SCHEMA.md`](docs/WS_MESSAGE_SCHEMA.md) — WebSocket message contract (relay to UI)
- [`README_legacy.md`](README_legacy.md) — Archived original README (Flask-based prototype)
