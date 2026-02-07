"""SOG (Speed Over Ground) and COG (Course Over Ground) computation.

Computes from successive position updates using finite differences.
Falls back gracefully when insufficient data is available.
"""

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass
from typing import Optional

# Conversion factor: m/s → knots
MPS_TO_KNOTS = 1.94384

# Approximate meters per degree at mid-latitudes (Hong Kong ~22°N)
# More accurate: use cos(lat) for longitude
METERS_PER_DEG_LAT = 111_320.0


@dataclass
class PositionSample:
    """A timestamped position sample for velocity computation."""

    lat: float
    lon: float
    ts_s: float  # Unix seconds (float)


@dataclass
class VelocityResult:
    """Computed SOG and COG from position samples."""

    sog_kn: float  # Speed over ground in knots
    cog_deg: float  # Course over ground in degrees (0–360)


class SogCogComputer:
    """Computes SOG/COG per device from successive position samples.

    Uses a sliding window of recent positions and finite differences.
    Thread-safe per-device: each device should use its own instance or
    the SogCogManager handles concurrency.
    """

    def __init__(self, max_samples: int = 5, max_age_s: float = 2.0) -> None:
        """Initialize the computer.

        Args:
            max_samples: Maximum number of samples to retain per device.
            max_age_s: Maximum age of samples to use for computation.
        """
        self._max_age_s = max_age_s
        self._samples: deque[PositionSample] = deque(maxlen=max_samples)

    def add_sample(self, lat: float, lon: float, ts_s: float) -> None:
        """Add a position sample.

        Args:
            lat: Latitude in degrees.
            lon: Longitude in degrees.
            ts_s: Timestamp in seconds (Unix epoch, float).
        """
        self._samples.append(PositionSample(lat=lat, lon=lon, ts_s=ts_s))

    def compute(self) -> Optional[VelocityResult]:
        """Compute SOG and COG from recent samples.

        Returns:
            VelocityResult if sufficient data, None otherwise.
        """
        if len(self._samples) < 2:
            return None

        now = time.time()
        # Use the two most recent samples within the age window
        recent = [
            s for s in self._samples if (now - s.ts_s) <= self._max_age_s
        ]

        if len(recent) < 2:
            return None

        p0 = recent[-2]
        p1 = recent[-1]

        dt = p1.ts_s - p0.ts_s
        if dt <= 0.001:  # Avoid division by near-zero
            return None

        # Convert lat/lon deltas to meters
        cos_lat = math.cos(math.radians((p0.lat + p1.lat) / 2.0))
        meters_per_deg_lon = METERS_PER_DEG_LAT * cos_lat

        dn_m = (p1.lat - p0.lat) * METERS_PER_DEG_LAT  # North
        de_m = (p1.lon - p0.lon) * meters_per_deg_lon  # East

        vel_n = dn_m / dt  # m/s northward
        vel_e = de_m / dt  # m/s eastward

        speed_mps = math.sqrt(vel_e**2 + vel_n**2)
        sog_kn = speed_mps * MPS_TO_KNOTS

        # COG: atan2(east, north) → degrees, mod 360
        cog_rad = math.atan2(vel_e, vel_n)
        cog_deg = math.degrees(cog_rad) % 360.0

        return VelocityResult(sog_kn=round(sog_kn, 1), cog_deg=round(cog_deg, 1))


class SogCogManager:
    """Manages SOG/COG computation for all devices.

    Maintains one SogCogComputer per device_id.
    """

    def __init__(self, max_samples: int = 5, max_age_s: float = 2.0) -> None:
        self._max_samples = max_samples
        self._max_age_s = max_age_s
        self._computers: dict[int, SogCogComputer] = {}

    def update(
        self, device_id: int, lat: float, lon: float, ts_s: float
    ) -> Optional[VelocityResult]:
        """Add a sample and return the latest velocity estimate.

        Args:
            device_id: Numeric device identifier.
            lat: Latitude in degrees.
            lon: Longitude in degrees.
            ts_s: Timestamp in seconds.

        Returns:
            VelocityResult or None.
        """
        if device_id not in self._computers:
            self._computers[device_id] = SogCogComputer(
                max_samples=self._max_samples, max_age_s=self._max_age_s
            )

        computer = self._computers[device_id]
        computer.add_sample(lat, lon, ts_s)
        return computer.compute()
