"""Session recording engine.

Records relay WS messages to .jsonl files for replay and export.
Each session is a directory containing:
  - messages.jsonl  — all relayed WSMessage objects, one per line
  - meta.json       — session metadata (id, start/end time, athletes, etc.)
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class SessionRecorder:
    """Append-only session recorder writing .jsonl files."""

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._session_id: Optional[str] = None
        self._session_dir: Optional[Path] = None
        self._fh = None  # file handle for messages.jsonl
        self._message_count: int = 0
        self._start_time: Optional[float] = None
        self._athlete_ids: set[str] = set()

    @property
    def is_recording(self) -> bool:
        return self._fh is not None

    @property
    def session_id(self) -> Optional[str]:
        return self._session_id

    @property
    def message_count(self) -> int:
        return self._message_count

    def start_session(self, session_id: Optional[str] = None) -> str:
        """Start recording a new session.

        Args:
            session_id: Optional session ID. If None, auto-generated.

        Returns:
            The session ID.
        """
        if self.is_recording:
            self.stop_session()

        if session_id is None:
            now = datetime.now(timezone.utc)
            session_id = f"S{now.strftime('%Y-%m-%d-%H%M%S')}"

        self._session_id = session_id
        self._session_dir = self._data_dir / session_id
        self._session_dir.mkdir(parents=True, exist_ok=True)

        messages_path = self._session_dir / "messages.jsonl"
        self._fh = open(messages_path, "a", encoding="utf-8")
        self._message_count = 0
        self._start_time = time.time()
        self._athlete_ids = set()

        logger.info("Session recording started: %s → %s", session_id, self._session_dir)
        return session_id

    def record(self, json_str: str) -> None:
        """Record a single serialized WS message."""
        if not self._fh:
            return

        self._fh.write(json_str + "\n")
        self._fh.flush()
        self._message_count += 1

        # Track athlete IDs for metadata
        try:
            msg = json.loads(json_str)
            msg_type = msg.get("type", "")
            payload = msg.get("payload", {})
            if msg_type == "position_update":
                for pos in payload.get("positions", []):
                    aid = pos.get("athlete_id")
                    if aid:
                        self._athlete_ids.add(aid)
            elif msg_type == "gate_metrics":
                for m in payload.get("metrics", []):
                    aid = m.get("athlete_id")
                    if aid:
                        self._athlete_ids.add(aid)
        except (json.JSONDecodeError, KeyError):
            pass

    def stop_session(self) -> Optional[dict]:
        """Stop recording and write metadata.

        Returns:
            Session metadata dict, or None if not recording.
        """
        if not self._fh:
            return None

        self._fh.close()
        self._fh = None

        end_time = time.time()
        duration_s = end_time - (self._start_time or end_time)

        meta = {
            "session_id": self._session_id,
            "start_time_utc": datetime.fromtimestamp(
                self._start_time or end_time, tz=timezone.utc
            ).isoformat(),
            "end_time_utc": datetime.fromtimestamp(
                end_time, tz=timezone.utc
            ).isoformat(),
            "duration_s": round(duration_s, 1),
            "message_count": self._message_count,
            "athlete_count": len(self._athlete_ids),
            "athlete_ids": sorted(self._athlete_ids),
            "schema_version": "1.0",
        }

        # Write meta.json
        if self._session_dir:
            meta_path = self._session_dir / "meta.json"
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)

        logger.info(
            "Session recording stopped: %s (%d messages, %.1fs)",
            self._session_id,
            self._message_count,
            duration_s,
        )

        self._session_id = None
        self._session_dir = None
        self._start_time = None
        self._athlete_ids = set()
        self._message_count = 0

        return meta

    def list_sessions(self) -> list[dict]:
        """List all recorded sessions with metadata.

        Returns:
            List of session metadata dicts, sorted by start time (newest first).
        """
        sessions = []

        if not self._data_dir.exists():
            return sessions

        for entry in self._data_dir.iterdir():
            if not entry.is_dir():
                continue
            meta_path = entry / "meta.json"
            if meta_path.exists():
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    meta["has_messages"] = (entry / "messages.jsonl").exists()
                    sessions.append(meta)
                except (json.JSONDecodeError, OSError) as e:
                    logger.warning("Failed to read session meta %s: %s", meta_path, e)
            else:
                # Legacy .jsonl files (single-file session packs)
                jsonl_files = list(entry.glob("*.jsonl"))
                if jsonl_files:
                    sessions.append({
                        "session_id": entry.name,
                        "start_time_utc": None,
                        "end_time_utc": None,
                        "duration_s": None,
                        "message_count": None,
                        "athlete_count": None,
                        "has_messages": True,
                    })

        # Also scan for top-level .jsonl files (legacy session packs)
        for jsonl in self._data_dir.glob("*.jsonl"):
            sessions.append({
                "session_id": jsonl.stem,
                "start_time_utc": None,
                "end_time_utc": None,
                "duration_s": None,
                "message_count": None,
                "athlete_count": None,
                "has_messages": True,
                "legacy_pack": True,
            })

        # Sort by start_time descending (newest first)
        sessions.sort(
            key=lambda s: s.get("start_time_utc") or "",
            reverse=True,
        )

        return sessions

    def get_session(self, session_id: str) -> Optional[dict]:
        """Get metadata for a specific session."""
        # Check directory-based session
        session_dir = self._data_dir / session_id
        meta_path = session_dir / "meta.json"
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            meta["has_messages"] = (session_dir / "messages.jsonl").exists()
            return meta

        # Check legacy .jsonl file
        legacy_path = self._data_dir / f"{session_id}.jsonl"
        if legacy_path.exists():
            return {
                "session_id": session_id,
                "has_messages": True,
                "legacy_pack": True,
            }

        return None

    def get_session_messages_path(self, session_id: str) -> Optional[Path]:
        """Get the path to the messages.jsonl file for a session.

        Returns:
            Path to the .jsonl file, or None if not found.
        """
        # Directory-based session
        msg_path = self._data_dir / session_id / "messages.jsonl"
        if msg_path.exists():
            return msg_path

        # Legacy .jsonl file
        legacy_path = self._data_dir / f"{session_id}.jsonl"
        if legacy_path.exists():
            return legacy_path

        return None

    def get_session_messages(self, session_id: str) -> list[dict]:
        """Load all messages for a session.

        Returns:
            List of parsed message dicts.
        """
        path = self.get_session_messages_path(session_id)
        if path is None:
            return []

        messages = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if not obj.get("_meta"):  # Skip metadata lines
                        messages.append(obj)
                except json.JSONDecodeError:
                    continue

        return messages

    def export_csv(self, session_id: str) -> Optional[str]:
        """Export session position data as CSV.

        Returns:
            CSV string, or None if session not found.
        """
        messages = self.get_session_messages(session_id)
        if not messages:
            return None

        lines = [
            "ts_ms,session_id,athlete_id,device_id,name,team,"
            "lat,lon,alt_m,sog_kn,cog_deg,dist_to_line_m,"
            "eta_to_line_s,speed_to_line_mps,status,data_age_ms"
        ]

        # Merge position and gate data by ts_ms + athlete_id
        # Collect position rows
        position_rows: dict[tuple, dict] = {}  # (ts_ms, athlete_id) → row
        for msg in messages:
            ts_ms = msg.get("ts_ms", 0)
            sid = msg.get("session_id", "")
            msg_type = msg.get("type", "")
            payload = msg.get("payload", {})

            if msg_type == "position_update":
                for pos in payload.get("positions", []):
                    key = (ts_ms, pos.get("athlete_id", ""))
                    position_rows[key] = {
                        "ts_ms": ts_ms,
                        "session_id": sid,
                        "athlete_id": pos.get("athlete_id", ""),
                        "device_id": pos.get("device_id", ""),
                        "name": pos.get("name", ""),
                        "team": pos.get("team", ""),
                        "lat": pos.get("lat", ""),
                        "lon": pos.get("lon", ""),
                        "alt_m": pos.get("alt_m", ""),
                        "sog_kn": pos.get("sog_kn", ""),
                        "cog_deg": pos.get("cog_deg", ""),
                        "dist_to_line_m": "",
                        "eta_to_line_s": "",
                        "speed_to_line_mps": "",
                        "status": "",
                        "data_age_ms": pos.get("data_age_ms", ""),
                    }

            elif msg_type == "gate_metrics":
                for m in payload.get("metrics", []):
                    key = (ts_ms, m.get("athlete_id", ""))
                    if key in position_rows:
                        position_rows[key]["dist_to_line_m"] = m.get("dist_to_line_m", "")
                        position_rows[key]["eta_to_line_s"] = m.get("eta_to_line_s", "")
                        position_rows[key]["speed_to_line_mps"] = m.get("speed_to_line_mps", "")
                        position_rows[key]["status"] = m.get("status", "")
                    else:
                        position_rows[key] = {
                            "ts_ms": ts_ms,
                            "session_id": sid,
                            "athlete_id": m.get("athlete_id", ""),
                            "device_id": m.get("device_id", ""),
                            "name": m.get("name", ""),
                            "team": "",
                            "lat": "",
                            "lon": "",
                            "alt_m": "",
                            "sog_kn": "",
                            "cog_deg": "",
                            "dist_to_line_m": m.get("dist_to_line_m", ""),
                            "eta_to_line_s": m.get("eta_to_line_s", ""),
                            "speed_to_line_mps": m.get("speed_to_line_mps", ""),
                            "status": m.get("status", ""),
                            "data_age_ms": "",
                        }

        # Sort by ts_ms, then athlete_id
        sorted_rows = sorted(position_rows.values(), key=lambda r: (r["ts_ms"], r["athlete_id"]))

        for row in sorted_rows:
            vals = [
                str(row.get(col, ""))
                for col in [
                    "ts_ms", "session_id", "athlete_id", "device_id", "name", "team",
                    "lat", "lon", "alt_m", "sog_kn", "cog_deg", "dist_to_line_m",
                    "eta_to_line_s", "speed_to_line_mps", "status", "data_age_ms",
                ]
            ]
            # Escape commas in name field
            vals[4] = f'"{vals[4]}"' if "," in vals[4] else vals[4]
            lines.append(",".join(vals))

        return "\n".join(lines)
