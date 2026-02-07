"""Parse raw HKSI_Pos messages into internal data structures.

Port 5000 (positions): custom text format
Port 5001 (gate metrics): JSON
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# Counters for observability (rule 80-metrics-logging)
_counters: dict[str, int] = {
    "position_batches_parsed": 0,
    "position_lines_parsed": 0,
    "position_parse_errors": 0,
    "gate_batches_parsed": 0,
    "gate_parse_errors": 0,
}


def get_parser_counters() -> dict[str, int]:
    """Return a copy of parser diagnostic counters."""
    return dict(_counters)


# ---------------------------------------------------------------------------
# Position batch (port 5000) — custom text format
# ---------------------------------------------------------------------------

@dataclass
class RawPosition:
    """A single position line parsed from the HKSI_Pos text format."""

    device_id: int
    latitude: float
    longitude: float
    altitude: float
    source_mask: int
    device_timestamp_us: int


@dataclass
class RawPositionBatch:
    """A parsed position batch from port 5000."""

    server_timestamp_us: int
    positions: list[RawPosition] = field(default_factory=list)


def parse_position_batch(raw_text: str) -> Optional[RawPositionBatch]:
    """Parse a position batch from the HKSI_Pos text format.

    Expected format:
        SERVER_TS:<server_timestamp_us>
        COUNT:<num_positions>
        POS:<device_id>:<latitude>:<longitude>:<altitude>:<source_mask>:<device_timestamp_us>
        ...

    Args:
        raw_text: The raw text payload (UTF-8 decoded).

    Returns:
        RawPositionBatch on success, None on parse failure.
    """
    try:
        lines = raw_text.strip().split("\n")
        server_ts_us = 0
        positions: list[RawPosition] = []

        for line in lines:
            line = line.strip()
            if not line:
                continue

            if line.startswith("SERVER_TS:"):
                server_ts_us = int(line.split(":", 1)[1])
            elif line.startswith("COUNT:"):
                # Informational; we count positions from POS lines
                pass
            elif line.startswith("POS:"):
                parts = line.split(":")
                if len(parts) < 7:
                    logger.warning("Malformed POS line (too few fields): %s", line)
                    _counters["position_parse_errors"] += 1
                    continue

                pos = RawPosition(
                    device_id=int(parts[1]),
                    latitude=float(parts[2]),
                    longitude=float(parts[3]),
                    altitude=float(parts[4]),
                    source_mask=int(parts[5]),
                    device_timestamp_us=int(parts[6]),
                )
                positions.append(pos)
                _counters["position_lines_parsed"] += 1
            else:
                logger.debug("Ignoring unknown line prefix: %s", line[:30])

        _counters["position_batches_parsed"] += 1
        return RawPositionBatch(
            server_timestamp_us=server_ts_us,
            positions=positions,
        )

    except Exception:
        _counters["position_parse_errors"] += 1
        logger.exception("Failed to parse position batch")
        return None


# ---------------------------------------------------------------------------
# Gate metrics batch (port 5001) — JSON
# ---------------------------------------------------------------------------

@dataclass
class RawGateMetric:
    """A single gate metric from HKSI_Pos JSON output."""

    tag_id: str
    gate_id: str
    anchor_left_id: str
    anchor_right_id: str
    server_timestamp_us: int
    estimate_timestamp_us: int
    d_perp_signed_m: float
    s_along: float
    gate_length_m: float
    crossing_event: str  # NO_CROSSING, CROSSING_LEFT, CROSSING_RIGHT
    crossing_time_us: Optional[int]
    crossing_confidence: float
    tag_position_quality: float
    time_to_line_s: Optional[float]
    speed_to_line_mps: float


@dataclass
class RawGateAlert:
    """A crossing alert from the HKSI_Pos gate metrics."""

    tag_id: str
    gate_id: str
    event: str
    crossing_time_us: int
    confidence: float


@dataclass
class RawGateMetricsBatch:
    """A parsed gate metrics batch from port 5001."""

    server_timestamp_us: int
    metrics: list[RawGateMetric] = field(default_factory=list)
    alerts: list[RawGateAlert] = field(default_factory=list)


def parse_gate_metrics_batch(raw_json: str) -> Optional[RawGateMetricsBatch]:
    """Parse a gate metrics batch from the HKSI_Pos JSON format.

    Args:
        raw_json: The raw JSON payload (UTF-8 decoded).

    Returns:
        RawGateMetricsBatch on success, None on parse failure.
    """
    try:
        data = json.loads(raw_json)
        server_ts_us = data.get("server_timestamp_us", 0)

        metrics: list[RawGateMetric] = []
        for m in data.get("metrics", []):
            metric = RawGateMetric(
                tag_id=m["tag_id"],
                gate_id=m.get("gate_id", "start_line"),
                anchor_left_id=m.get("anchor_left_id", "A0"),
                anchor_right_id=m.get("anchor_right_id", "A1"),
                server_timestamp_us=m.get("server_timestamp_us", server_ts_us),
                estimate_timestamp_us=m.get("estimate_timestamp_us", 0),
                d_perp_signed_m=m.get("d_perp_signed_m", 0.0),
                s_along=m.get("s_along", 0.0),
                gate_length_m=m.get("gate_length_m", 0.0),
                crossing_event=m.get("crossing_event", "NO_CROSSING"),
                crossing_time_us=m.get("crossing_time_us"),
                crossing_confidence=m.get("crossing_confidence", 0.0),
                tag_position_quality=m.get("tag_position_quality", 0.0),
                time_to_line_s=m.get("time_to_line_s"),
                speed_to_line_mps=m.get("speed_to_line_mps", 0.0),
            )
            metrics.append(metric)

        alerts: list[RawGateAlert] = []
        for a in data.get("alerts", []):
            alert = RawGateAlert(
                tag_id=a["tag_id"],
                gate_id=a.get("gate_id", "start_line"),
                event=a.get("event", "NO_CROSSING"),
                crossing_time_us=a.get("crossing_time_us", 0),
                confidence=a.get("confidence", 0.0),
            )
            alerts.append(alert)

        _counters["gate_batches_parsed"] += 1
        return RawGateMetricsBatch(
            server_timestamp_us=server_ts_us,
            metrics=metrics,
            alerts=alerts,
        )

    except Exception:
        _counters["gate_parse_errors"] += 1
        logger.exception("Failed to parse gate metrics batch")
        return None
