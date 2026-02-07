"""Pydantic models for all WebSocket message types.

These models define the relay → UI contract (WS_MESSAGE_SCHEMA.md v1.0).
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class MessageType(str, Enum):
    """WebSocket message types."""

    POSITION_UPDATE = "position_update"
    GATE_METRICS = "gate_metrics"
    START_LINE_DEFINITION = "start_line_definition"
    DEVICE_HEALTH = "device_health"
    EVENT = "event"
    HEARTBEAT = "heartbeat"


class AthleteStatus(str, Enum):
    """Coaching status classification."""

    SAFE = "SAFE"
    APPROACHING = "APPROACHING"
    RISK = "RISK"
    CROSSED = "CROSSED"
    OCS = "OCS"
    STALE = "STALE"


class CrossingEvent(str, Enum):
    """Crossing event from HKSI_Pos."""

    NO_CROSSING = "NO_CROSSING"
    CROSSING_LEFT = "CROSSING_LEFT"
    CROSSING_RIGHT = "CROSSING_RIGHT"


class EventKind(str, Enum):
    """Discrete event types."""

    CROSSING = "CROSSING"
    OCS = "OCS"
    RISK_ALERT = "RISK_ALERT"
    START_SIGNAL = "START_SIGNAL"
    DEVICE_OFFLINE = "DEVICE_OFFLINE"
    DEVICE_ONLINE = "DEVICE_ONLINE"


class DeviceType(str, Enum):
    """Device categories."""

    ANCHOR = "ANCHOR"
    TAG = "TAG"
    GATEWAY = "GATEWAY"


class GateQuality(str, Enum):
    """Start-line quality assessment."""

    GOOD = "GOOD"
    DEGRADED = "DEGRADED"
    UNKNOWN = "UNKNOWN"


# ---------------------------------------------------------------------------
# Payload models
# ---------------------------------------------------------------------------

class PositionEntry(BaseModel):
    """A single athlete position in a position_update batch."""

    athlete_id: str
    device_id: int
    name: str
    team: str
    lat: float
    lon: float
    alt_m: float
    sog_kn: Optional[float] = None
    cog_deg: Optional[float] = None
    source_mask: int
    device_ts_ms: int
    data_age_ms: int


class PositionUpdatePayload(BaseModel):
    """Payload for position_update messages."""

    positions: list[PositionEntry]


class GateMetricEntry(BaseModel):
    """A single athlete's gate metrics."""

    athlete_id: str
    device_id: int
    name: str
    dist_to_line_m: float
    s_along: float
    eta_to_line_s: Optional[float] = None
    speed_to_line_mps: float
    gate_length_m: float
    status: AthleteStatus
    crossing_event: CrossingEvent = CrossingEvent.NO_CROSSING
    crossing_confidence: float = 0.0
    position_quality: float = 0.0


class GateAlert(BaseModel):
    """A crossing alert within a gate_metrics batch."""

    athlete_id: str
    name: str
    event: CrossingEvent
    crossing_ts_ms: int
    confidence: float


class GateMetricsPayload(BaseModel):
    """Payload for gate_metrics messages."""

    metrics: list[GateMetricEntry]
    alerts: list[GateAlert] = Field(default_factory=list)


class AnchorPoint(BaseModel):
    """An anchor endpoint of the start line."""

    device_id: int
    anchor_id: str
    lat: float
    lon: float


class StartLineDefinitionPayload(BaseModel):
    """Payload for start_line_definition messages."""

    anchor_left: AnchorPoint
    anchor_right: AnchorPoint
    gate_length_m: float
    quality: GateQuality = GateQuality.UNKNOWN


class DeviceHealthPayload(BaseModel):
    """Payload for device_health messages."""

    device_id: str
    device_type: DeviceType
    online: bool
    last_seen_ms: int
    battery_pct: Optional[float] = None
    packet_loss_pct: Optional[float] = None
    rssi_dbm: Optional[float] = None
    time_sync_offset_ms: Optional[float] = None


class EventPayload(BaseModel):
    """Payload for event messages."""

    event_kind: EventKind
    athlete_id: Optional[str] = None
    name: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)


class HeartbeatPayload(BaseModel):
    """Payload for heartbeat messages."""

    uptime_s: int
    connected_clients: int
    zmq_position_connected: bool
    zmq_gate_connected: bool
    athletes_tracked: int
    messages_relayed: int


# ---------------------------------------------------------------------------
# Envelope
# ---------------------------------------------------------------------------

class WSMessage(BaseModel):
    """Common WebSocket message envelope."""

    type: MessageType
    schema_version: str = "1.0"
    seq: int
    ts_ms: int = Field(default_factory=lambda: int(time.time() * 1000))
    session_id: Optional[str] = None
    payload: (
        PositionUpdatePayload
        | GateMetricsPayload
        | StartLineDefinitionPayload
        | DeviceHealthPayload
        | EventPayload
        | HeartbeatPayload
    )

    def to_json_str(self) -> str:
        """Serialize to JSON string for WebSocket transmission."""
        return self.model_dump_json()
