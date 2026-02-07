"""Athlete registry: maps device_id → athlete metadata.

Loaded from a JSON config file at startup.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AthleteInfo:
    """Immutable record for a registered athlete."""

    device_id: int
    athlete_id: str
    name: str
    team: str


class AthleteRegistry:
    """In-memory athlete registry backed by a JSON file.

    Provides O(1) lookup by device_id.
    """

    def __init__(self) -> None:
        self._by_device_id: dict[int, AthleteInfo] = {}

    def load(self, path: Path) -> None:
        """Load athlete registry from a JSON file.

        Args:
            path: Path to the athletes.json config file.

        Raises:
            FileNotFoundError: If the config file does not exist.
            json.JSONDecodeError: If the file is not valid JSON.
        """
        logger.info("Loading athlete registry from %s", path)
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)

        athletes = data.get("athletes", [])
        self._by_device_id.clear()

        for entry in athletes:
            info = AthleteInfo(
                device_id=entry["device_id"],
                athlete_id=entry["athlete_id"],
                name=entry["name"],
                team=entry["team"],
            )
            self._by_device_id[info.device_id] = info

        logger.info("Loaded %d athletes into registry", len(self._by_device_id))

    def get(self, device_id: int) -> Optional[AthleteInfo]:
        """Look up athlete by device_id.

        Args:
            device_id: The numeric device identifier (1–99 for tags).

        Returns:
            AthleteInfo if found, None otherwise.
        """
        return self._by_device_id.get(device_id)

    def get_or_default(self, device_id: int) -> AthleteInfo:
        """Look up athlete, returning a synthetic entry if not registered.

        Args:
            device_id: The numeric device identifier.

        Returns:
            AthleteInfo — real or synthetic.
        """
        info = self._by_device_id.get(device_id)
        if info is not None:
            return info

        # Generate synthetic entry for unregistered devices
        if 1 <= device_id <= 99:
            tag_idx = device_id - 1
            return AthleteInfo(
                device_id=device_id,
                athlete_id=f"T{tag_idx:02d}",
                name=f"Tag {tag_idx}",
                team="UNKNOWN",
            )
        return AthleteInfo(
            device_id=device_id,
            athlete_id=f"DEV{device_id}",
            name=f"Device {device_id}",
            team="UNKNOWN",
        )

    @property
    def count(self) -> int:
        """Return the number of registered athletes."""
        return len(self._by_device_id)

    def all_athletes(self) -> list[AthleteInfo]:
        """Return all registered athletes sorted by device_id."""
        return sorted(self._by_device_id.values(), key=lambda a: a.device_id)
