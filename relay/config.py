"""Relay service configuration.

Uses pydantic-settings to load from environment variables with sensible defaults.
"""

from pathlib import Path
from pydantic_settings import BaseSettings


class RelaySettings(BaseSettings):
    """Configuration for the relay/bridge service."""

    # HKSI_Pos ZMQ endpoints
    zmq_position_endpoint: str = "tcp://localhost:5000"
    zmq_gate_endpoint: str = "tcp://localhost:5001"
    zmq_position_topic: str = "position"
    zmq_gate_topic: str = "gate"

    # HKSI_Pos HTTP health
    hksi_pos_health_url: str = "http://localhost:8080/health"
    hksi_pos_metrics_url: str = "http://localhost:8080/metrics"

    # Relay WebSocket / HTTP
    host: str = "0.0.0.0"
    port: int = 8000
    ws_path: str = "/ws"

    # Athlete registry
    athlete_registry_path: Path = Path(__file__).parent / "data" / "athletes.json"

    # Start-line anchors
    anchor_left_device_id: int = 101
    anchor_right_device_id: int = 102

    # Status classification thresholds
    threshold_distance_m: float = 50.0  # X: distance for APPROACHING
    threshold_time_s: float = 5.0  # Y: ETA for RISK
    threshold_stale_s: float = 3.0  # N: staleness timeout

    # SOG/COG computation
    sog_cog_min_samples: int = 2
    sog_cog_max_age_s: float = 2.0  # Max age of samples for computation

    # Heartbeat interval
    heartbeat_interval_s: float = 5.0

    # Session recording
    session_data_dir: Path = Path(__file__).parent / "data" / "session_packs"

    # ZMQ reconnect
    zmq_reconnect_min_s: float = 1.0
    zmq_reconnect_max_s: float = 30.0

    # Sign convention: if True, negate d_perp_signed_m so positive = pre-start
    gate_sign_flip: bool = False

    model_config = {"env_prefix": "RELAY_"}


def get_settings() -> RelaySettings:
    """Return a cached settings instance."""
    return RelaySettings()
