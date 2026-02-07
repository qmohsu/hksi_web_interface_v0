"""FastAPI entry point for the relay/bridge service.

Bridges HKSI_Pos ZMQ streams to WebSocket for the Coach Monitor UI.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from relay.athlete_registry import AthleteRegistry
from relay.config import RelaySettings, get_settings
from relay.message_parser import (
    parse_gate_metrics_batch,
    parse_position_batch,
    get_parser_counters,
)
from relay.models import (
    AthleteStatus,
    CrossingEvent,
    DeviceHealthPayload,
    DeviceType,
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
    AnchorPoint,
    WSMessage,
)
from relay.sog_cog import SogCogManager
from relay.status_classifier import StatusClassifier
from relay.ws_manager import WSConnectionManager
from relay.zmq_subscriber import ZMQSubscriber

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

settings = get_settings()
registry = AthleteRegistry()
sog_cog = SogCogManager(
    max_samples=settings.sog_cog_min_samples + 3,
    max_age_s=settings.sog_cog_max_age_s,
)
classifier = StatusClassifier(
    distance_threshold_m=settings.threshold_distance_m,
    time_threshold_s=settings.threshold_time_s,
    stale_threshold_s=settings.threshold_stale_s,
)
ws_manager = WSConnectionManager()

# ZMQ subscribers (initialized on startup)
zmq_position_sub: ZMQSubscriber | None = None
zmq_gate_sub: ZMQSubscriber | None = None

# Sequence counter
_seq = 0
_start_time = time.time()
_messages_relayed = 0

# Anchor position cache (for start-line definition)
_anchor_positions: dict[int, dict] = {}

# Session
_session_id: str | None = None


def _next_seq() -> int:
    """Return the next monotonic sequence number."""
    global _seq
    _seq += 1
    return _seq


# ---------------------------------------------------------------------------
# Message processing callbacks
# ---------------------------------------------------------------------------

async def _on_position_message(topic: str, payload: str) -> None:
    """Process a position batch from HKSI_Pos port 5000."""
    global _messages_relayed

    batch = parse_position_batch(payload)
    if batch is None:
        return

    now_ms = int(time.time() * 1000)
    positions: list[PositionEntry] = []

    for raw_pos in batch.positions:
        # Skip anchors — handled separately for start-line definition
        if raw_pos.device_id >= 100:
            _update_anchor(raw_pos.device_id, raw_pos)
            continue

        # Look up athlete info
        athlete = registry.get_or_default(raw_pos.device_id)

        # Compute SOG/COG
        device_ts_s = raw_pos.device_timestamp_us / 1_000_000.0
        velocity = sog_cog.update(
            raw_pos.device_id, raw_pos.latitude, raw_pos.longitude, device_ts_s
        )

        # Update staleness tracker
        classifier.update_last_seen(raw_pos.device_id)

        device_ts_ms = raw_pos.device_timestamp_us // 1000
        data_age_ms = max(0, now_ms - device_ts_ms)

        positions.append(
            PositionEntry(
                athlete_id=athlete.athlete_id,
                device_id=raw_pos.device_id,
                name=athlete.name,
                team=athlete.team,
                lat=raw_pos.latitude,
                lon=raw_pos.longitude,
                alt_m=raw_pos.altitude,
                sog_kn=velocity.sog_kn if velocity else None,
                cog_deg=velocity.cog_deg if velocity else None,
                source_mask=raw_pos.source_mask,
                device_ts_ms=device_ts_ms,
                data_age_ms=data_age_ms,
            )
        )

    if positions:
        msg = WSMessage(
            type=MessageType.POSITION_UPDATE,
            seq=_next_seq(),
            ts_ms=now_ms,
            session_id=_session_id,
            payload=PositionUpdatePayload(positions=positions),
        )
        await ws_manager.broadcast_text(msg.to_json_str())
        _messages_relayed += 1


def _update_anchor(device_id: int, raw_pos) -> None:
    """Cache anchor positions and detect start-line changes."""
    _anchor_positions[device_id] = {
        "device_id": device_id,
        "lat": raw_pos.latitude,
        "lon": raw_pos.longitude,
    }


async def _on_gate_message(topic: str, payload: str) -> None:
    """Process a gate metrics batch from HKSI_Pos port 5001."""
    global _messages_relayed

    batch = parse_gate_metrics_batch(payload)
    if batch is None:
        return

    now_ms = int(time.time() * 1000)
    metrics: list[GateMetricEntry] = []
    alerts: list[GateAlert] = []

    for raw_metric in batch.metrics:
        # Resolve device_id from tag_id (e.g., "T0" → device_id 1)
        tag_idx = _tag_id_to_device_id(raw_metric.tag_id)
        athlete = registry.get_or_default(tag_idx)

        # Apply sign convention
        d_perp = raw_metric.d_perp_signed_m
        if settings.gate_sign_flip:
            d_perp = -d_perp

        # Classify status
        status = classifier.classify(
            device_id=tag_idx,
            d_perp_signed_m=d_perp,
            speed_to_line_mps=raw_metric.speed_to_line_mps,
            time_to_line_s=raw_metric.time_to_line_s,
            crossing_event=raw_metric.crossing_event,
            crossing_time_us=raw_metric.crossing_time_us,
        )

        metrics.append(
            GateMetricEntry(
                athlete_id=athlete.athlete_id,
                device_id=tag_idx,
                name=athlete.name,
                dist_to_line_m=d_perp,
                s_along=raw_metric.s_along,
                eta_to_line_s=raw_metric.time_to_line_s,
                speed_to_line_mps=raw_metric.speed_to_line_mps,
                gate_length_m=raw_metric.gate_length_m,
                status=status,
                crossing_event=CrossingEvent(raw_metric.crossing_event),
                crossing_confidence=raw_metric.crossing_confidence,
                position_quality=raw_metric.tag_position_quality,
            )
        )

    # Process alerts
    for raw_alert in batch.alerts:
        tag_idx = _tag_id_to_device_id(raw_alert.tag_id)
        athlete = registry.get_or_default(tag_idx)
        crossing_ts_ms = raw_alert.crossing_time_us // 1000

        alerts.append(
            GateAlert(
                athlete_id=athlete.athlete_id,
                name=athlete.name,
                event=CrossingEvent(raw_alert.event),
                crossing_ts_ms=crossing_ts_ms,
                confidence=raw_alert.confidence,
            )
        )

        # Also emit a discrete event message
        event_msg = WSMessage(
            type=MessageType.EVENT,
            seq=_next_seq(),
            ts_ms=now_ms,
            session_id=_session_id,
            payload=EventPayload(
                event_kind=EventKind.CROSSING,
                athlete_id=athlete.athlete_id,
                name=athlete.name,
                details={
                    "crossing_event": raw_alert.event,
                    "confidence": raw_alert.confidence,
                },
            ),
        )
        await ws_manager.broadcast_text(event_msg.to_json_str())
        _messages_relayed += 1

    if metrics:
        msg = WSMessage(
            type=MessageType.GATE_METRICS,
            seq=_next_seq(),
            ts_ms=now_ms,
            session_id=_session_id,
            payload=GateMetricsPayload(metrics=metrics, alerts=alerts),
        )
        await ws_manager.broadcast_text(msg.to_json_str())
        _messages_relayed += 1


def _tag_id_to_device_id(tag_id: str) -> int:
    """Convert a tag string like 'T0' to device_id 1.

    Args:
        tag_id: Tag identifier string (e.g., "T0", "T1", ...).

    Returns:
        Numeric device_id (T0=1, T1=2, ...).
    """
    try:
        idx = int(tag_id.replace("T", ""))
        return idx + 1
    except (ValueError, AttributeError):
        logger.warning("Could not parse tag_id: %s", tag_id)
        return 0


# ---------------------------------------------------------------------------
# Heartbeat task
# ---------------------------------------------------------------------------

async def _heartbeat_task() -> None:
    """Periodically send heartbeat messages to connected clients."""
    while True:
        await asyncio.sleep(settings.heartbeat_interval_s)

        if ws_manager.client_count == 0:
            continue

        uptime_s = int(time.time() - _start_time)
        msg = WSMessage(
            type=MessageType.HEARTBEAT,
            seq=_next_seq(),
            ts_ms=int(time.time() * 1000),
            session_id=_session_id,
            payload=HeartbeatPayload(
                uptime_s=uptime_s,
                connected_clients=ws_manager.client_count,
                zmq_position_connected=(
                    zmq_position_sub.connected if zmq_position_sub else False
                ),
                zmq_gate_connected=(
                    zmq_gate_sub.connected if zmq_gate_sub else False
                ),
                athletes_tracked=registry.count,
                messages_relayed=_messages_relayed,
            ),
        )
        await ws_manager.broadcast_text(msg.to_json_str())


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """Startup and shutdown logic for the FastAPI app."""
    global zmq_position_sub, zmq_gate_sub

    logger.info("Relay service starting...")

    # Load athlete registry
    try:
        registry.load(settings.athlete_registry_path)
    except FileNotFoundError:
        logger.warning(
            "Athlete registry not found at %s — using synthetic names",
            settings.athlete_registry_path,
        )

    # Get the running event loop
    loop = asyncio.get_running_loop()

    # Start ZMQ subscribers
    zmq_position_sub = ZMQSubscriber(
        endpoint=settings.zmq_position_endpoint,
        topic=settings.zmq_position_topic,
        name="position-sub",
        reconnect_min_s=settings.zmq_reconnect_min_s,
        reconnect_max_s=settings.zmq_reconnect_max_s,
    )
    zmq_position_sub.start(async_callback=_on_position_message, loop=loop)

    zmq_gate_sub = ZMQSubscriber(
        endpoint=settings.zmq_gate_endpoint,
        topic=settings.zmq_gate_topic,
        name="gate-sub",
        reconnect_min_s=settings.zmq_reconnect_min_s,
        reconnect_max_s=settings.zmq_reconnect_max_s,
    )
    zmq_gate_sub.start(async_callback=_on_gate_message, loop=loop)

    # Start heartbeat task
    heartbeat = asyncio.create_task(_heartbeat_task())

    logger.info("Relay service ready — listening on %s:%d", settings.host, settings.port)
    yield

    # Shutdown
    logger.info("Relay service shutting down...")
    heartbeat.cancel()
    if zmq_position_sub:
        zmq_position_sub.stop()
    if zmq_gate_sub:
        zmq_gate_sub.stop()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="HKSI Coach Monitor Relay",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for Coach Monitor UI clients."""
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; handle client messages if any
            data = await websocket.receive_text()
            # Currently we ignore client messages, but could handle
            # start_signal, session controls, etc. in the future
            logger.debug("Received client message: %s", data[:100])
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict:
    """Relay + upstream health check."""
    return {
        "status": "healthy",
        "uptime_s": int(time.time() - _start_time),
        "zmq_position_connected": (
            zmq_position_sub.connected if zmq_position_sub else False
        ),
        "zmq_gate_connected": (
            zmq_gate_sub.connected if zmq_gate_sub else False
        ),
        "ws_clients": ws_manager.client_count,
        "athletes_registered": registry.count,
        "messages_relayed": _messages_relayed,
        "parser_counters": get_parser_counters(),
    }


@app.get("/api/athletes")
async def list_athletes() -> dict:
    """Return the athlete registry."""
    athletes = registry.all_athletes()
    return {
        "athletes": [
            {
                "device_id": a.device_id,
                "athlete_id": a.athlete_id,
                "name": a.name,
                "team": a.team,
            }
            for a in athletes
        ]
    }


@app.get("/api/sessions")
async def list_sessions() -> dict:
    """List available sessions (stub for Phase 0)."""
    return {"sessions": []}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "relay.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )
