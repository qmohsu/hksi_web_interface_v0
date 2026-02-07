"""Coaching status classification engine.

Classifies each athlete into SAFE / APPROACHING / RISK / CROSSED / OCS / STALE
based on gate metrics from HKSI_Pos and optional start-signal time.

See Design Doc Section 7.4 for the canonical status definitions.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from relay.models import AthleteStatus, CrossingEvent

logger = logging.getLogger(__name__)


class StatusClassifier:
    """Classifies athlete status based on gate metrics and timing.

    Attributes:
        distance_threshold_m: Distance threshold X for APPROACHING.
        time_threshold_s: ETA threshold Y for RISK.
        stale_threshold_s: Staleness threshold N.
        start_signal_ts_ms: Optional start signal timestamp (ms).
    """

    def __init__(
        self,
        distance_threshold_m: float = 50.0,
        time_threshold_s: float = 5.0,
        stale_threshold_s: float = 3.0,
    ) -> None:
        self.distance_threshold_m = distance_threshold_m
        self.time_threshold_s = time_threshold_s
        self.stale_threshold_s = stale_threshold_s
        self.start_signal_ts_ms: Optional[int] = None

        # Track last-seen time per device for staleness detection
        self._last_seen: dict[int, float] = {}

    def set_start_signal(self, ts_ms: int) -> None:
        """Record the start signal time.

        Args:
            ts_ms: Start signal timestamp in milliseconds (Unix epoch).
        """
        self.start_signal_ts_ms = ts_ms
        logger.info("Start signal recorded at %d ms", ts_ms)

    def clear_start_signal(self) -> None:
        """Clear the start signal (e.g., for a new race)."""
        self.start_signal_ts_ms = None

    def update_last_seen(self, device_id: int) -> None:
        """Update the last-seen timestamp for a device.

        Args:
            device_id: Numeric device identifier.
        """
        self._last_seen[device_id] = time.time()

    def classify(
        self,
        device_id: int,
        d_perp_signed_m: float,
        speed_to_line_mps: float,
        time_to_line_s: Optional[float],
        crossing_event: str,
        crossing_time_us: Optional[int] = None,
    ) -> AthleteStatus:
        """Classify an athlete's coaching status.

        Args:
            device_id: Numeric device identifier.
            d_perp_signed_m: Signed perpendicular distance to line (meters).
                Positive = pre-start side after relay sign mapping.
            speed_to_line_mps: Speed component toward the line (m/s).
            time_to_line_s: Estimated time to line (seconds), or None.
            crossing_event: One of NO_CROSSING, CROSSING_LEFT, CROSSING_RIGHT.
            crossing_time_us: Crossing timestamp in microseconds (optional).

        Returns:
            AthleteStatus enum value.
        """
        # Check staleness first
        last_seen = self._last_seen.get(device_id)
        if last_seen is not None:
            age_s = time.time() - last_seen
            if age_s > self.stale_threshold_s:
                return AthleteStatus.STALE

        # Check crossing events
        if crossing_event != CrossingEvent.NO_CROSSING.value:
            # Check if OCS: crossing before start signal
            if (
                self.start_signal_ts_ms is not None
                and crossing_time_us is not None
            ):
                crossing_ts_ms = crossing_time_us // 1000
                if crossing_ts_ms < self.start_signal_ts_ms:
                    return AthleteStatus.OCS
            return AthleteStatus.CROSSED

        # Check RISK: ETA below threshold and start signal is set
        if (
            time_to_line_s is not None
            and time_to_line_s < self.time_threshold_s
            and self.start_signal_ts_ms is not None
        ):
            # Only RISK if the crossing hasn't happened yet and
            # current time is before start signal
            now_ms = int(time.time() * 1000)
            if now_ms < self.start_signal_ts_ms:
                return AthleteStatus.RISK

        # Check APPROACHING: within distance threshold and moving toward line
        abs_dist = abs(d_perp_signed_m)
        if abs_dist < self.distance_threshold_m and speed_to_line_mps > 0.5:
            return AthleteStatus.APPROACHING

        return AthleteStatus.SAFE
