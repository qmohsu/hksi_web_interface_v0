#!/usr/bin/env python3
"""Mock WebSocket server for UI development.

Replays a session pack (.jsonl file) or generates synthetic data,
serving the same WebSocket contract as the real relay service.

Phase 2: includes session management, replay, and export APIs.

Usage:
    python -m relay.mock_server                          # Generate synthetic data
    python -m relay.mock_server --pack data/session_packs/CLEAN_START.jsonl
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import random
import time
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from relay.models import (
    AnchorPoint,
    AthleteStatus,
    CrossingEvent,
    EventKind,
    EventPayload,
    GateAlert,
    GateMetricEntry,
    GateMetricsPayload,
    GateQuality,
    HeartbeatPayload,
    MessageType,
    PositionEntry,
    PositionUpdatePayload,
    StartLineDefinitionPayload,
    WSMessage,
)
from relay.session_recorder import SessionRecorder

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mock athletes (25 athletes as per scalability target)
# ---------------------------------------------------------------------------

MOCK_ATHLETES = [
    {"device_id": i + 1, "athlete_id": f"T{i:02d}", "name": name, "team": "HKG"}
    for i, name in enumerate(
        [
            "CHAN SIU MING", "WONG KA HO", "LEE SONGHA", "LAM HOI YAN",
            "CHEUNG WAI KIT", "NG CHI FUNG", "TSANG YIK HEI", "HO MAN WAI",
            "YIP CHUN HIM", "FUNG KA LONG", "LEUNG PAK YIN", "CHENG WING YAN",
            "TANG SZE WING", "LUI TSZ CHING", "MAK YEE TING", "KWOK HIN WAH",
            "AU YEUNG TSZ KIN", "SIN KA YAN", "POON SZE MAN", "LAU WING TUNG",
            "CHOW HOI CHING", "IP KA MAN", "SO TSZ YIN", "YUEN WING LAM",
            "CHAN TSZ HIN",
        ]
    )
]

# Start-line anchor positions (Hong Kong waters)
ANCHOR_LEFT = {"device_id": 101, "anchor_id": "A0", "lat": 22.29600, "lon": 114.16800}
ANCHOR_RIGHT = {"device_id": 102, "anchor_id": "A1", "lat": 22.29620, "lon": 114.16850}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

app = FastAPI(title="HKSI Mock Relay")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_clients: list[WebSocket] = []
_seq = 0
_session_id = "MOCK-SESSION"
_start_time = time.time()
_messages_sent = 0

# Session recorder (points to session_packs dir)
_session_data_dir = Path(__file__).parent / "data" / "session_packs"
_recorder = SessionRecorder(_session_data_dir)
_recording = False


def _next_seq() -> int:
    global _seq
    _seq += 1
    return _seq


# ---------------------------------------------------------------------------
# Synthetic data generator
# ---------------------------------------------------------------------------

class SyntheticGenerator:
    """Generates realistic position and gate metric data for 25 athletes."""

    def __init__(self) -> None:
        self._t0 = time.time()
        self._states = []
        for i, athlete in enumerate(MOCK_ATHLETES):
            angle = (2 * math.pi * i) / len(MOCK_ATHLETES) + random.uniform(-0.3, 0.3)
            dist = random.uniform(80, 200)
            speed_kn = random.uniform(5, 12)
            self._states.append({
                "athlete": athlete,
                "angle": angle,
                "initial_dist_m": dist,
                "speed_kn": speed_kn,
                "lat_offset": random.uniform(-0.001, 0.001),
                "lon_offset": random.uniform(-0.001, 0.001),
                "crossed": False,
            })

    def generate_positions(self) -> list[PositionEntry]:
        now_ms = int(time.time() * 1000)
        elapsed_s = time.time() - self._t0
        positions: list[PositionEntry] = []

        mid_lat = (ANCHOR_LEFT["lat"] + ANCHOR_RIGHT["lat"]) / 2
        mid_lon = (ANCHOR_LEFT["lon"] + ANCHOR_RIGHT["lon"]) / 2

        for state in self._states:
            athlete = state["athlete"]
            speed_mps = state["speed_kn"] / 1.94384
            dist_m = max(0.5, state["initial_dist_m"] - speed_mps * elapsed_s)

            angle = state["angle"]
            lat_offset = dist_m * math.cos(angle) / 111320.0
            lon_offset = dist_m * math.sin(angle) / (111320.0 * math.cos(math.radians(mid_lat)))

            lat = mid_lat + lat_offset + random.uniform(-0.000005, 0.000005)
            lon = mid_lon + lon_offset + random.uniform(-0.000005, 0.000005)

            sog = state["speed_kn"] + random.uniform(-0.5, 0.5)
            cog = (math.degrees(angle) + 180) % 360 + random.uniform(-5, 5)

            positions.append(
                PositionEntry(
                    athlete_id=athlete["athlete_id"],
                    device_id=athlete["device_id"],
                    name=athlete["name"],
                    team=athlete["team"],
                    lat=round(lat, 8),
                    lon=round(lon, 8),
                    alt_m=round(0.3 + random.uniform(-0.1, 0.1), 2),
                    sog_kn=round(max(0, sog), 1),
                    cog_deg=round(cog % 360, 1),
                    source_mask=1,
                    device_ts_ms=now_ms - random.randint(50, 200),
                    data_age_ms=random.randint(80, 250),
                )
            )

        return positions

    def generate_gate_metrics(self) -> tuple[list[GateMetricEntry], list[GateAlert]]:
        elapsed_s = time.time() - self._t0
        metrics: list[GateMetricEntry] = []
        alerts: list[GateAlert] = []

        for state in self._states:
            athlete = state["athlete"]
            speed_mps = state["speed_kn"] / 1.94384
            dist_m = state["initial_dist_m"] - speed_mps * elapsed_s

            crossing_event = CrossingEvent.NO_CROSSING
            if dist_m <= 0 and not state["crossed"]:
                crossing_event = CrossingEvent.CROSSING_LEFT
                state["crossed"] = True
                alerts.append(
                    GateAlert(
                        athlete_id=athlete["athlete_id"],
                        name=athlete["name"],
                        event=CrossingEvent.CROSSING_LEFT,
                        crossing_ts_ms=int(time.time() * 1000),
                        confidence=round(random.uniform(0.8, 0.98), 2),
                    )
                )

            if state["crossed"]:
                status = AthleteStatus.CROSSED
            elif abs(dist_m) < 50 and speed_mps > 0.5:
                status = AthleteStatus.APPROACHING
            else:
                status = AthleteStatus.SAFE

            eta = abs(dist_m) / max(speed_mps, 0.1) if speed_mps > 0.1 else None

            metrics.append(
                GateMetricEntry(
                    athlete_id=athlete["athlete_id"],
                    device_id=athlete["device_id"],
                    name=athlete["name"],
                    dist_to_line_m=round(dist_m, 2),
                    s_along=round(random.uniform(0.1, 0.9), 2),
                    eta_to_line_s=round(eta, 1) if eta is not None else None,
                    speed_to_line_mps=round(speed_mps, 2),
                    gate_length_m=30.0,
                    status=status,
                    crossing_event=crossing_event,
                    crossing_confidence=0.0 if crossing_event == CrossingEvent.NO_CROSSING else 0.9,
                    position_quality=round(random.uniform(0.7, 0.99), 2),
                )
            )

        return metrics, alerts


# ---------------------------------------------------------------------------
# Session pack replayer
# ---------------------------------------------------------------------------

class SessionPackReplayer:
    """Replays a .jsonl session pack file."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._messages: list[dict] = []
        self._meta: dict = {}

    def load(self) -> None:
        with open(self._path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if obj.get("_meta"):
                    self._meta = obj
                else:
                    self._messages.append(obj)

        logger.info(
            "Loaded session pack: %s (%d messages)",
            self._path.name,
            len(self._messages),
        )

    async def replay(self, broadcast_fn) -> None:
        if not self._messages:
            logger.warning("No messages to replay")
            return

        base_ts = self._messages[0].get("ts_ms", 0)
        start_wall = time.time()

        for msg in self._messages:
            msg_offset_ms = msg.get("ts_ms", 0) - base_ts
            target_wall = start_wall + msg_offset_ms / 1000.0
            delay = target_wall - time.time()
            if delay > 0:
                await asyncio.sleep(delay)

            msg["ts_ms"] = int(time.time() * 1000)
            msg["seq"] = _next_seq()
            await broadcast_fn(json.dumps(msg))

        logger.info("Session pack replay complete")


# ---------------------------------------------------------------------------
# Broadcasting
# ---------------------------------------------------------------------------

async def _broadcast(text: str) -> None:
    global _messages_sent
    disconnected = []
    for ws in _clients:
        try:
            await ws.send_text(text)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in _clients:
            _clients.remove(ws)
    _messages_sent += 1
    # Record if recording
    if _recording:
        _recorder.record(text)


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

async def _synthetic_loop() -> None:
    gen = SyntheticGenerator()

    # Send start-line definition first
    await asyncio.sleep(0.5)
    start_line_msg = WSMessage(
        type=MessageType.START_LINE_DEFINITION,
        seq=_next_seq(),
        ts_ms=int(time.time() * 1000),
        session_id=_session_id,
        payload=StartLineDefinitionPayload(
            anchor_left=AnchorPoint(**ANCHOR_LEFT),
            anchor_right=AnchorPoint(**ANCHOR_RIGHT),
            gate_length_m=30.0,
            quality=GateQuality.GOOD,
        ),
    )
    await _broadcast(start_line_msg.to_json_str())

    while True:
        await asyncio.sleep(0.1)  # 10 Hz

        if not _clients:
            continue

        now_ms = int(time.time() * 1000)

        # Position update
        positions = gen.generate_positions()
        pos_msg = WSMessage(
            type=MessageType.POSITION_UPDATE,
            seq=_next_seq(),
            ts_ms=now_ms,
            session_id=_session_id,
            payload=PositionUpdatePayload(positions=positions),
        )
        await _broadcast(pos_msg.to_json_str())

        # Gate metrics
        metrics, alerts = gen.generate_gate_metrics()
        gate_msg = WSMessage(
            type=MessageType.GATE_METRICS,
            seq=_next_seq(),
            ts_ms=now_ms,
            session_id=_session_id,
            payload=GateMetricsPayload(metrics=metrics, alerts=alerts),
        )
        await _broadcast(gate_msg.to_json_str())

        # Emit crossing events
        for alert in alerts:
            event_msg = WSMessage(
                type=MessageType.EVENT,
                seq=_next_seq(),
                ts_ms=now_ms,
                session_id=_session_id,
                payload=EventPayload(
                    event_kind=EventKind.CROSSING,
                    athlete_id=alert.athlete_id,
                    name=alert.name,
                    details={
                        "crossing_event": alert.event.value,
                        "confidence": alert.confidence,
                    },
                ),
            )
            await _broadcast(event_msg.to_json_str())


async def _heartbeat_loop() -> None:
    while True:
        await asyncio.sleep(5.0)
        if not _clients:
            continue
        msg = WSMessage(
            type=MessageType.HEARTBEAT,
            seq=_next_seq(),
            ts_ms=int(time.time() * 1000),
            session_id=_session_id,
            payload=HeartbeatPayload(
                uptime_s=int(time.time() - _start_time),
                connected_clients=len(_clients),
                zmq_position_connected=False,
                zmq_gate_connected=False,
                athletes_tracked=len(MOCK_ATHLETES),
                messages_relayed=_messages_sent,
            ),
        )
        await _broadcast(msg.to_json_str())


# ---------------------------------------------------------------------------
# Routes — WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    _clients.append(websocket)
    logger.info("Client connected. Total: %d", len(_clients))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in _clients:
            _clients.remove(websocket)
        logger.info("Client disconnected. Total: %d", len(_clients))


# ---------------------------------------------------------------------------
# Routes — HTTP API
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "healthy",
        "mode": "mock",
        "clients": len(_clients),
        "recording": _recording,
        "recording_session": _recorder.session_id if _recording else None,
    }


@app.get("/api/athletes")
async def athletes() -> dict:
    return {"athletes": MOCK_ATHLETES}


# --- Session management ---

@app.get("/api/sessions")
async def list_sessions() -> dict:
    sessions = _recorder.list_sessions()
    return {"sessions": sessions}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str) -> dict:
    meta = _recorder.get_session(session_id)
    if meta is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"Session '{session_id}' not found"},
        )
    return meta


@app.post("/api/sessions/start")
async def start_session(session_id: str | None = None) -> dict:
    global _recording, _session_id
    sid = _recorder.start_session(session_id)
    _recording = True
    _session_id = sid
    return {"status": "recording", "session_id": sid}


@app.post("/api/sessions/stop")
async def stop_session() -> dict:
    global _recording, _session_id
    meta = _recorder.stop_session()
    _recording = False
    _session_id = "MOCK-SESSION"
    if meta is None:
        return {"status": "not_recording"}
    return {"status": "stopped", **meta}


# --- Replay data ---

@app.get("/api/sessions/{session_id}/messages")
async def get_session_messages(session_id: str) -> dict:
    messages = _recorder.get_session_messages(session_id)
    if not messages:
        return JSONResponse(
            status_code=404,
            content={"error": f"No messages found for session '{session_id}'"},
        )
    return {"session_id": session_id, "count": len(messages), "messages": messages}


# --- Export ---

@app.get("/api/sessions/{session_id}/export", response_model=None)
async def export_session(
    session_id: str,
    format: str = Query(default="json", pattern="^(csv|json)$"),
):
    if format == "csv":
        csv_str = _recorder.export_csv(session_id)
        if csv_str is None:
            return JSONResponse(
                status_code=404,
                content={"error": f"No data for session '{session_id}'"},
            )
        return PlainTextResponse(
            content=csv_str,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{session_id}.csv"'
            },
        )
    else:
        messages = _recorder.get_session_messages(session_id)
        if not messages:
            return JSONResponse(
                status_code=404,
                content={"error": f"No data for session '{session_id}'"},
            )
        return JSONResponse(
            content={"session_id": session_id, "messages": messages},
            headers={
                "Content-Disposition": f'attachment; filename="{session_id}.json"'
            },
        )


# ---------------------------------------------------------------------------
# Serve frontend static files (if built)
# ---------------------------------------------------------------------------

_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Mock WebSocket server for Coach Monitor UI")
    parser.add_argument(
        "--pack",
        type=str,
        default=None,
        help="Path to a .jsonl session pack file to replay",
    )
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    from contextlib import asynccontextmanager

    if args.pack:
        pack_path = Path(args.pack)
        replayer = SessionPackReplayer(pack_path)
        replayer.load()

        @asynccontextmanager
        async def lifespan(_app):
            asyncio.create_task(replayer.replay(_broadcast))
            asyncio.create_task(_heartbeat_loop())
            yield
    else:
        @asynccontextmanager
        async def lifespan(_app):
            asyncio.create_task(_synthetic_loop())
            asyncio.create_task(_heartbeat_loop())
            yield

    app.router.lifespan_context = lifespan
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
